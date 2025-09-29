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

// (getSettings, updateDiscordSettingsなどの関数は変更なし)
// --- 設定値を取得するためのヘルパー関数 ---
async function getSettings() {
  const doc = await db.collection("settings").doc("config").get();
  return doc.exists ? doc.data() : {};
}

// --- 設定管理関数 ---
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
  const {discordMemberRoleEnabled, discordInRoomRoleEnabled, serverId, memberRoleId, inRoomRoleId, token} = request.data;
  await db.collection("settings").doc("config").set({
    discordMemberRoleEnabled: !!discordMemberRoleEnabled,
    discordInRoomRoleEnabled: !!discordInRoomRoleEnabled,
    discordServerId: serverId,
    discordMemberRoleId: memberRoleId,
    discordInRoomRoleId: inRoomRoleId,
    discordBotToken: token,
  }, {merge: true});
  return {result: "Discord設定を更新しました。"};
});

exports.updateApiKey = onCall(runtimeOpts, async (request) => {
  if (!context.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  // keyTypeでどのAPIキーを更新するか判断
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
  ...runtimeOpts,
}, async (event) => {
  const settings = await getSettings();
  if (!settings.discordBotToken || !settings.discordServerId) {
    console.log("BotトークンまたはサーバーIDが未設定のため、自動同期をスキップしました。");
    return;
  }
  const discordApi = axios.create({
    baseURL: "https://discord.com/api/v10",
    headers: {Authorization: `Bot ${settings.discordBotToken}`},
  });
  const serverId = settings.discordServerId;
  const memberRoleId = settings.discordMemberRoleId;
  const inRoomRoleId = settings.discordInRoomRoleId;
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!after || !after.discordId) {
    if (before && before.discordId) {
      console.log(`メンバー ${before.name} が削除されたため、ロールを剥奪します。`);
      if (memberRoleId) await discordApi.delete(`/guilds/${serverId}/members/${before.discordId}/roles/${memberRoleId}`).catch((e) => console.error(JSON.stringify(e.response?.data)));
      if (inRoomRoleId) await discordApi.delete(`/guilds/${serverId}/members/${before.discordId}/roles/${inRoomRoleId}`).catch((e) => console.error(JSON.stringify(e.response?.data)));
    }
    return;
  }
  const discordUserId = after.discordId;
  if (settings.discordMemberRoleEnabled && memberRoleId && (!before || before.isExpired !== after.isExpired)) {
    try {
      if (after.isExpired) {
        await discordApi.delete(`/guilds/${serverId}/members/${discordUserId}/roles/${memberRoleId}`);
      } else {
        await discordApi.put(`/guilds/${serverId}/members/${discordUserId}/roles/${memberRoleId}`);
      }
    } catch (e) {
      console.error("部員ロール更新失敗:", JSON.stringify(e.response?.data));
    }
  }
  if (settings.discordInRoomRoleEnabled && inRoomRoleId && (!before || before.status !== after.status)) {
    try {
      if (after.status === "in" && !after.isExpired) {
        await discordApi.put(`/guilds/${serverId}/members/${discordUserId}/roles/${inRoomRoleId}`);
      } else {
        await discordApi.delete(`/guilds/${serverId}/members/${discordUserId}/roles/${inRoomRoleId}`);
      }
    } catch (e) {
      console.error("部内ロール更新失敗:", JSON.stringify(e.response?.data));
    }
  }
});

exports.manualSyncDiscordRoles = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const settings = await getSettings();
  if (!settings.discordBotToken || !settings.discordServerId) {
    throw new HttpsError("failed-precondition", "DiscordのBotトークンまたはサーバーIDが設定されていません。");
  }
  const discordApi = axios.create({
    baseURL: "https://discord.com/api/v10",
    headers: {Authorization: `Bot ${settings.discordBotToken}`},
  });
  const membersSnapshot = await db.collection("members").get();
  let successCount = 0;
  let errorCount = 0;
  for (const doc of membersSnapshot.docs) {
    const member = doc.data();
    if (!member.discordId) continue;
    try {
      if (settings.discordMemberRoleId) {
        if (member.isExpired) {
          await discordApi.delete(`/guilds/${settings.discordServerId}/members/${member.discordId}/roles/${settings.discordMemberRoleId}`);
        } else {
          await discordApi.put(`/guilds/${settings.discordServerId}/members/${member.discordId}/roles/${settings.discordMemberRoleId}`);
        }
      }
      if (settings.discordInRoomRoleId) {
        if (member.status === "in" && !member.isExpired) {
          await discordApi.put(`/guilds/${settings.discordServerId}/members/${member.discordId}/roles/${settings.discordInRoomRoleId}`);
        } else {
          await discordApi.delete(`/guilds/${settings.discordServerId}/members/${member.discordId}/roles/${settings.discordInRoomRoleId}`);
        }
      }
      successCount++;
    } catch (error) {
      console.error(`同期失敗: ${member.name} (${member.discordId})`, error.response?.data);
      errorCount++;
    }
  }
  return {result: `同期完了。成功: ${successCount}件, 失敗: ${errorCount}件`};
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

exports.updateAdmin = onCall(runtimeOpts, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {uid, newEmail} = request.data;
  await auth.updateUser(uid, {email: newEmail});
  await db.collection("admins").doc(uid).update({email: newEmail});
  return {result: "管理者のメールアドレスを更新しました。"};
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
  const {token, templateData} = request.data;
  if (!token || !templateData) {
    throw new HttpsError("invalid-argument", "トークンとテンプレートデータが必要です。");
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
  await db.collection("biometrics").add({
    memberId: tokenData.memberId,
    type: tokenData.type,
    templateData: templateData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await tokenRef.delete();
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


exports.identifyMemberByFace = onCall(runtimeOpts, async (request) => {
  // ▼▼▼ 初期化が完了するのを待つ ▼▼▼
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
  const queryDescriptor = new Float32Array(descriptor);
  let bestMatch = {memberId: null, distance: 0.5};
  for (const doc of snapshot.docs) {
    const docData = doc.data();
    if (docData.templateData && Array.isArray(docData.templateData)) {
      const storedDescriptor = new Float32Array(docData.templateData);
      const distance = faceapi.euclideanDistance(queryDescriptor, storedDescriptor);
      if (distance < bestMatch.distance) {
        bestMatch = {memberId: docData.memberId, distance: distance};
      }
    }
  }
  if (bestMatch.memberId) {
    const memberDoc = await db.collection("members").doc(bestMatch.memberId).get();
    if (memberDoc.exists) {
      return {
        id: memberDoc.id,
        ...memberDoc.data(),
      };
    }
  }
  return null;
});

// --- 顔認証API ---
exports.verifyFaceAPI = onRequest(runtimeOpts, async (req, res) => {
  const cors = require("cors")({ origin: true });
  cors(req, res, async () => {
    try {
      // 1. 初期化が完了するのを待つ
      await initializationPromise;

      // 2. APIキーを検証
      const settings = await getSettings();
      const storedApiKey = settings.faceVerifyApiKey;
      if (!storedApiKey) {
        console.error("顔認証APIキーが設定されていません。");
        return res.status(500).send({ error: "API key is not configured." });
      }
      const apiKey = req.headers["x-api-key"];
      if (apiKey !== storedApiKey) {
        return res.status(403).send({ error: "Forbidden" });
      }

      // 3. リクエストボディからdescriptorを取得
      const { descriptor } = req.body;
      if (!descriptor || !Array.isArray(descriptor) || descriptor.length !== 128) {
        return res.status(400).send({ error: "Invalid descriptor data." });
      }
      
      // 4. データベース内の顔情報と照合
      const snapshot = await db.collection("biometrics").where("type", "==", "face").get();
      if (snapshot.empty) {
        return res.status(404).send({ error: "No face data registered." });
      }

      const queryDescriptor = new Float32Array(descriptor);
      let bestMatch = { memberId: null, distance: 0.5 }; // 認証しきい値

      for (const doc of snapshot.docs) {
        const docData = doc.data();
        if (docData.templateData && Array.isArray(docData.templateData)) {
          const storedDescriptor = new Float32Array(docData.templateData);
          const distance = faceapi.euclideanDistance(queryDescriptor, storedDescriptor);
          if (distance < bestMatch.distance) {
            bestMatch = { memberId: docData.memberId, distance: distance };
          }
        }
      }

      // 5. 最も一致した部員の情報を返す
      if (bestMatch.memberId) {
        const memberDoc = await db.collection("members").doc(bestMatch.memberId).get();
        if (memberDoc.exists) {
          const memberData = memberDoc.data();
          // 失効している場合は認証失敗とする
          if (memberData.isExpired) {
            return res.status(200).json({ status: "fail", reason: "Member is expired." });
          }
          return res.status(200).json({ 
            status: "success",
            member: {
              name: memberData.name,
              grade: memberData.grade || "",
              project: memberData.project || "",
              status: memberData.status,
            }
          });
        }
      }
      
      // 6. 一致する部員が見つからなかった場合
      return res.status(200).json({ status: "fail", reason: "No matching member found." });

    } catch (error) {
      console.error("顔認証APIでエラー:", error);
      return res.status(500).send({ error: "Internal Server Error" });
    }
  });
});