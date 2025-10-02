const functions = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onRequest} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const path = require("path");

// ▼▼▼ face-api.js と TensorFlow.js の初期化処理を修正 ▼▼▼
const tf = require("@tensorflow/tfjs-core");
require("@tensorflow/tfjs-backend-wasm");
const faceapi = require("face-api.js");

// 非同期の初期化処理をまとめる
const modelsPath = path.join(__dirname, "weights");
const initializationPromise = (async () => {
  // 1. WASMバックエンドを設定し、準備が完了するまで待つ
  await tf.setBackend("wasm");
  await tf.ready();
  console.log(`Using TensorFlow.js backend: ${tf.getBackend()}`);

  // 2. face-api.jsに設定済みのtfインスタンスを教える (モンキーパッチ)
  faceapi.env.monkeyPatch({tf});

  // 3. バックエンド設定後にモデルを読み込む
  await Promise.all([
    faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath),
    faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath),
    faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath),
  ]);
  console.log("Face-API models loaded for Node.js");
})();
// ▲▲▲ 初期化処理ここまで ▲▲▲

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// 関数の実行設定
const runtimeOpts = {
  timeoutSeconds: 60,
  memory: "1GiB",
  region: "asia-northeast1",
};

const longRuntimeOpts = {
  timeoutSeconds: 540, // タイムアウトを9分に延長
  memory: "1GiB",
  region: "asia-northeast1",
};

// --- 設定値を取得するためのヘルパー関数 ---
async function getSettings() {
  const doc = await db.collection("settings").doc("config").get();
  return doc.exists ? doc.data() : {};
}

// (getSettings, updateDiscordSettingsなどの関数は変更なし)
exports.getSettings = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  return getSettings();
});

exports.updateDiscordSettings = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const { discordBotToken, discordServerId, discordRules } = request.data;
  await db.collection("settings").doc("config").set({
    discordBotToken,
    discordServerId,
    discordRules: discordRules || [],
  }, { merge: true });
  return { result: "Discord設定を更新しました。" };
});

exports.updateApiKey = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const { apiKey, keyType } = request.data;
  if (!apiKey || !keyType) {
    throw new HttpsError("invalid-argument", "APIキーとキーの種類が必要です。");
  }
  let fieldToUpdate;
  if (keyType === 'memberApiKey') {
    fieldToUpdate = 'memberApiKey';
  } else if (keyType === 'faceVerifyApiKey') {
    fieldToUpdate = 'faceVerifyApiKey';
  } else {
    throw new HttpsError("invalid-argument", "無効なキーの種類です。");
  }
  await db.collection("settings").doc("config").set({ [fieldToUpdate]: apiKey }, { merge: true });
  return { result: "APIキーを更新しました。" };
});

// --- 部員名簿API ---
exports.getMemberListAPI = onRequest(runtimeOpts, async (req, res) => {
  const cors = require("cors")({origin: true});
  cors(req, res, async () => {
    const settings = await getSettings();
    const storedApiKey = settings.memberApiKey;
    if (!storedApiKey) {
      console.error("APIキーがFirestoreで設定されていません。");
      res.status(500).send({error: "API key is not configured on the server."});
      return;
    }
    const apiKey = req.headers["x-api-key"];
    if (apiKey !== storedApiKey) {
      console.warn("無効なAPIキーでAPIアクセスがありました。");
      res.status(403).send({error: "Forbidden"});
      return;
    }
    try {
      const membersSnapshot = await db.collection("members")
          .where("isExpired", "==", false)
          .orderBy("name", "asc")
          .get();
      const memberList = membersSnapshot.docs.map((doc) => {
        const memberData = doc.data();
        const expiryDateISO = memberData.expiryDate ?
          memberData.expiryDate.toDate().toISOString() : null;
        return {
          name: memberData.name,
          furigana: memberData.furigana || "",
          grade: memberData.grade || "",
          project: memberData.project || "",
          roles: memberData.roles || [],
          status: memberData.status,
          discordId: memberData.discordId || "",
          email: memberData.email || "",
          expiryDate: expiryDateISO,
        };
      });
      res.status(200).send(memberList);
    } catch (error) {
      console.error("APIでのFirestoreデータ取得中にエラー:", error);
      res.status(500).send({error: "Internal Server Error"});
    }
  });
});

// --- Discord連携関数 ---
exports.manageDiscordRoles = onDocumentWritten({
    document: "members/{memberId}",
    ...runtimeOpts
}, async (event) => {
    const settings = await getSettings();
    if (!settings.discordBotToken || !settings.discordServerId || !settings.discordRules) {
        return;
    }
    const discordApi = axios.create({
        baseURL: "https://discord.com/api/v10",
        headers: { Authorization: `Bot ${settings.discordBotToken}` },
    });
    const serverId = settings.discordServerId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const discordId = (after || before)?.discordId;
    if (!discordId) return;
    if (!after) {
        console.log(`メンバー ${before.name} が削除されたため、ロールを剥奪します。`);
        for (const rule of settings.discordRules) {
            if (rule.roleId) {
                await discordApi.delete(`/guilds/${serverId}/members/${discordId}/roles/${rule.roleId}`).catch(() => {});
            }
        }
        return;
    }
    for (const rule of settings.discordRules) {
        if (!rule.enabled || !rule.property || !rule.roleId) continue;
        const checkCondition = (member) => {
            if (!member) return false;
            switch (rule.property) {
                case 'status': return member.status === rule.value;
                case 'grade': return member.grade === rule.value;
                case 'roles': return (member.roles || []).includes(rule.value);
                case 'isExpired':
                    return String(!!member.isExpired) === rule.value;
                default: return false;
            }
        };
        const shouldHaveRoleBefore = checkCondition(before);
        const shouldHaveRoleAfter = checkCondition(after);
        try {
            if (shouldHaveRoleAfter && !shouldHaveRoleBefore) {
                await discordApi.put(`/guilds/${serverId}/members/${discordId}/roles/${rule.roleId}`);
            } else if (!shouldHaveRoleAfter && shouldHaveRoleBefore) {
                await discordApi.delete(`/guilds/${serverId}/members/${discordId}/roles/${rule.roleId}`);
            }
        } catch (e) {
            console.error(`ロール更新失敗 (${rule.roleId}):`, JSON.stringify(e.response?.data));
        }
    }
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.manualSyncDiscordRoles = onCall(longRuntimeOpts, async (request) => {
    if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
        throw new HttpsError("permission-denied", "権限がありません。");
    }
    const settings = await getSettings();
    if (!settings.discordBotToken || !settings.discordServerId || !settings.discordRules) {
        throw new HttpsError("failed-precondition", "DiscordのBotトークン、サーバーID、またはルールが設定されていません。");
    }
    functions.logger.info("手動同期を開始します...", {rules: settings.discordRules.length});
    const discordApi = axios.create({
        baseURL: "https://discord.com/api/v10",
        headers: { Authorization: `Bot ${settings.discordBotToken}` },
    });
    const serverId = settings.discordServerId;
    const membersSnapshot = await db.collection("members").get();
    let successCount = 0;
    let errorCount = 0;
    for (const doc of membersSnapshot.docs) {
        const member = doc.data();
        if (!member.discordId) continue;
        functions.logger.info(`処理中: ${member.name} (Discord ID: ${member.discordId})`);
        let hasErrorInMember = false;
        for (const rule of settings.discordRules) {
            if (!rule.enabled || !rule.property || !rule.roleId) continue;
            const checkCondition = (m) => {
                if (!m) return false;
                const isExpiredValue = m.isExpired === true;
                switch (rule.property) {
                    case 'status': return m.status === rule.value;
                    case 'grade': return m.grade === rule.value;
                    case 'roles': return (m.roles || []).includes(rule.value);
                    case 'isExpired': return String(isExpiredValue) === rule.value;
                    default: return false;
                }
            };
            const shouldHaveRole = checkCondition(member);
            functions.logger.info(`  ルール評価: [${rule.property} == ${rule.value}], 結果: ${shouldHaveRole ? '付与対象' : '剥奪対象'}, ロールID: ${rule.roleId}`);
            const maxRetries = 3;
            let success = false;
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    if (shouldHaveRole) {
                        await discordApi.put(`/guilds/${serverId}/members/${member.discordId}/roles/${rule.roleId}`);
                    } else {
                        await discordApi.delete(`/guilds/${serverId}/members/${member.discordId}/roles/${rule.roleId}`);
                    }
                    functions.logger.info(`    -> 成功 (試行 ${attempt}回目)`);
                    success = true;
                    break;
                } catch (error) {
                    if (error.response?.status === 429) {
                        const retryAfter = (error.response.data.retry_after || 1) * 1000 + 500;
                        functions.logger.warn(`    -> レート制限を検知。${retryAfter}ms 待機します... (試行 ${attempt}/${maxRetries})`);
                        await wait(retryAfter);
                    } else if (error.response?.status === 404 || error.response?.data?.code === 10011) {
                        functions.logger.warn(`    -> スキップ: メンバーまたはロールが見つかりません。`);
                        success = true;
                        break;
                    } else {
                        functions.logger.error(`    -> 失敗 (試行 ${attempt}/${maxRetries}):`, { error: error.response?.data });
                        hasErrorInMember = true;
                        break;
                    }
                }
            }
            if (!success) {
                functions.logger.error(`    -> 最終的な失敗: ${maxRetries}回のリトライ後も成功しませんでした。`);
                hasErrorInMember = true;
            }
            await wait(100);
        }
        hasErrorInMember ? errorCount++ : successCount++;
    }
    functions.logger.info(`手動同期完了。成功: ${successCount}件, 失敗: ${errorCount}件`);
    return { result: `同期完了。成功: ${successCount}件, 失敗: ${errorCount}件` };
});

// --- 管理者CRUD関数 ---
exports.addAdmin = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {email, password} = request.data;
  if (!email || !password || password.length < 6) {
    throw new HttpsError("invalid-argument", "メールアドレスと6文字以上のパスワードを指定してください。");
  }
  try {
    const userRecord = await auth.createUser({email, password});
    await db.collection("admins").doc(userRecord.uid).set({
      email: email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {result: `ユーザー ${email} を管理者として作成しました。`};
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "このメールアドレスは既に使用されています。");
    }
    throw new HttpsError("internal", "ユーザー作成に失敗しました。");
  }
});

exports.listAdmins = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const adminDocs = await db.collection("admins").get();
  const adminUsers = await Promise.all(
      adminDocs.docs.map((doc) => auth.getUser(doc.id).catch(() => null)),
  );
  return adminUsers.filter((user) => user).map((user) => ({uid: user.uid, email: user.email}));
});

exports.deleteAdmin = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {uid} = request.data;
  if (request.auth.uid === uid) {
    throw new HttpsError("invalid-argument", "自分自身を削除することはできません。");
  }
  await auth.deleteUser(uid);
  await db.collection("admins").doc(uid).delete();
  return {result: "管理者を削除しました。"};
});

// --- 生体情報登録・削除関数 ---
exports.generateEnrollmentToken = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {memberId, biometricType} = request.data;
  if (!memberId || !biometricType) {
    throw new HttpsError("invalid-argument", "部員IDと種別が必要です。");
  }
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const tokenDoc = await db.collection("enrollment_tokens").add({
    memberId: memberId,
    type: biometricType,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
  });
  return {token: tokenDoc.id};
});

exports.registerBiometric = onCall(runtimeOpts, async (request) => {
  // "templateData" から "templates" に変更し、配列であることをチェック
  const {token, templates} = request.data;
  if (!token || !templates || !Array.isArray(templates)) {
    throw new HttpsError("invalid-argument", "トークンとテンプレートデータの配列が必要です。");
  }

  const tokenRef = db.collection("enrollment_tokens").doc(token);
  const tokenDoc = await tokenRef.get();

  if (!tokenDoc.exists) {
    throw new HttpsError("not-found", "無効なトークンです。");
  }
  const tokenData = tokenDoc.data();
  if (tokenData.expiresAt.toDate() < new Date()) {
    await tokenRef.delete();
    throw new HttpsError("deadline-exceeded", "トークンの有効期限が切れています。");
  }

  // 既存の同タイプの生体情報を一度すべて削除
  const existingSnapshot = await db.collection("biometrics")
      .where("memberId", "==", tokenData.memberId)
      .where("type", "==", tokenData.type)
      .get();

  const batch = db.batch();
  if (!existingSnapshot.empty) {
    console.log(`既存の ${tokenData.type} 情報を削除します。`);
    existingSnapshot.docs.forEach(doc => batch.delete(doc.ref));
  }

  // 新しい特徴量データをループして、それぞれ個別のドキュメントとして追加
  templates.forEach(templateData => {
    const newDocRef = db.collection("biometrics").doc();
    batch.set(newDocRef, {
      memberId: tokenData.memberId,
      type: tokenData.type,
      templateData: templateData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  batch.delete(tokenRef); // 使用済みトークンを削除

  await batch.commit();
  return {result: `${tokenData.type} の登録が成功しました。`};
});

exports.deleteBiometric = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {memberId, biometricType} = request.data;
  if (!memberId || !biometricType) {
    throw new HttpsError("invalid-argument", "部員IDと種別が必要です。");
  }
  try {
    const snapshot = await db.collection("biometrics")
        .where("memberId", "==", memberId)
        .where("type", "==", biometricType)
        .get();
    if (snapshot.empty) {
      throw new HttpsError("not-found", "削除対象のデータが見つかりませんでした。");
    }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return {result: `${biometricType} の情報を削除しました。`};
  } catch (error) {
    console.error("生体情報の削除中にエラー:", error);
    throw new HttpsError("internal", "データの削除に失敗しました。");
  }
});


// 管理者向けの顔識別関数
exports.identifyMemberByFace = onCall(runtimeOpts, async (request) => {
  await initializationPromise;

  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {descriptor} = request.data;
  if (!descriptor) {
    throw new HttpsError("invalid-argument", "顔データが必要です。");
  }
  const snapshot = await db.collection("biometrics")
      .where("type", "==", "face")
      .get();
  if (snapshot.empty) {
    throw new HttpsError("not-found", "登録されている顔データがありません。");
  }
  
  const settings = await getSettings();
  const distanceThreshold = settings.faceRecognitionThreshold || 0.5;
  const queryDescriptor = new Float32Array(descriptor);

  // メンバーごとの最も良い（小さい）距離を保持するためのMap
  const memberDistances = new Map();

  // 1. 全ての顔データをループし、メンバーごとに最小距離を記録する
  for (const doc of snapshot.docs) {
    const docData = doc.data();
    if (docData.templateData && Array.isArray(docData.templateData)) {
      const storedDescriptor = new Float32Array(docData.templateData);
      const distance = faceapi.euclideanDistance(queryDescriptor, storedDescriptor);

      // Mapに記録されている距離より小さい場合、更新する
      if (!memberDistances.has(docData.memberId) || distance < memberDistances.get(docData.memberId)) {
        memberDistances.set(docData.memberId, distance);
      }
    }
  }

  // 2. Mapから、全メンバーの中でのベストマッチとセカンドベストマッチを探す
  let bestMatch = {memberId: null, distance: Infinity};
  let secondBestMatch = {memberId: null, distance: Infinity};
  
  for (const [memberId, distance] of memberDistances.entries()) {
      if (distance < bestMatch.distance) {
        secondBestMatch = bestMatch;
        bestMatch = {memberId, distance};
      } else if (distance < secondBestMatch.distance) {
        secondBestMatch = {memberId, distance};
      }
  }

  // 3. 最終的な本人判定を行う
  let finalMemberId = null;
  if (bestMatch.distance < distanceThreshold) {
    const ratioThreshold = 0.7; 
    if (secondBestMatch.distance === Infinity || (bestMatch.distance / secondBestMatch.distance) < ratioThreshold) {
        finalMemberId = bestMatch.memberId;
    } else {
        console.log(`認証拒否: 曖昧な一致です。 Best[${bestMatch.distance}] vs 2ndBest[${secondBestMatch.distance}]`);
    }
  }

  if (finalMemberId) {
    const memberDoc = await db.collection("members").doc(finalMemberId).get();
    if (memberDoc.exists) {
      return {
        id: memberDoc.id,
        ...memberDoc.data(),
      };
    }
  }
  return null;
});


// 外部API向けの顔認証関数
exports.verifyFaceAPI = onRequest(runtimeOpts, async (req, res) => {
  const cors = require("cors")({ origin: true });
  cors(req, res, async () => {
    try {
      await initializationPromise;
      const settings = await getSettings();
      const storedApiKey = settings.faceVerifyApiKey;
      if (!storedApiKey) {
        return res.status(500).send({ error: "API key is not configured." });
      }
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== storedApiKey) {
        return res.status(403).send({ error: "Forbidden" });
      }
      const { descriptor } = req.body;
      if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
        return res.status(400).send({ error: "Invalid descriptor data." });
      }
      const snapshot = await db.collection("biometrics").where("type", "==", "face").get();
      if (snapshot.empty) {
        return res.status(404).send({ error: "No face data registered." });
      }

      const distanceThreshold = settings.faceRecognitionThreshold || 0.5;
      const queryDescriptor = new Float32Array(descriptor);
      
      const memberDistances = new Map();

      for (const doc of snapshot.docs) {
        const docData = doc.data();
        if (docData.templateData && Array.isArray(docData.templateData)) {
          const storedDescriptor = new Float32Array(docData.templateData);
          const distance = faceapi.euclideanDistance(queryDescriptor, storedDescriptor);

          if (!memberDistances.has(docData.memberId) || distance < memberDistances.get(docData.memberId)) {
            memberDistances.set(docData.memberId, distance);
          }
        }
      }

      let bestMatch = { memberId: null, distance: Infinity };
      let secondBestMatch = { memberId: null, distance: Infinity };
      
      for (const [memberId, distance] of memberDistances.entries()) {
        if (distance < bestMatch.distance) {
          secondBestMatch = bestMatch;
          bestMatch = { memberId, distance };
        } else if (distance < secondBestMatch.distance) {
          secondBestMatch = { memberId, distance };
        }
      }

      let finalMemberId = null;
      if (bestMatch.distance < distanceThreshold) {
        const ratioThreshold = 0.8;
        if (secondBestMatch.distance === Infinity || (bestMatch.distance / secondBestMatch.distance) < ratioThreshold) {
            finalMemberId = bestMatch.memberId;
        } else {
            console.log(`API認証拒否: 曖昧な一致です。 Best[${bestMatch.distance.toFixed(4)}] vs 2ndBest[${secondBestMatch.distance.toFixed(4)}]`);
        }
      }

      if (finalMemberId) {
        const memberDoc = await db.collection("members").doc(finalMemberId).get();
        if (memberDoc.exists) {
          const memberData = memberDoc.data();
          if (memberData.isExpired) {
            return res.status(200).json({ status: "fail", reason: "Member is expired." });
          }
          return res.status(200).json({
            status: "success",
            member: { name: memberData.name, grade: memberData.grade || "", project: memberData.project || "", status: memberData.status }
          });
        }
      }
      return res.status(200).json({ status: "fail", reason: "No matching member found." });

    } catch (error) {
      console.error("顔認証APIでエラー:", error);
      return res.status(500).send({ error: "Internal Server Error" });
    }
  });
});