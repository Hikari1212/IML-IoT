const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// 全ての関数のリージョンをアジア東北1（東京）に設定
setGlobalOptions({region: "asia-northeast1"});

// --- 設定値を取得するためのヘルパー関数 ---
async function getSettings() {
  const doc = await db.collection("settings").doc("config").get();
  return doc.exists ? doc.data() : {};
}


// --- 設定管理関数 ---

// 全ての設定を取得する関数
exports.getSettings = onCall({cors: true}, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  return getSettings();
});

// Discord設定を更新する関数
exports.updateDiscordSettings = onCall({cors: true}, async (request) => {
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

// APIキーを更新する関数
exports.updateApiKey = onCall({cors: true}, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {apiKey} = request.data;
  await db.collection("settings").doc("config").set({memberApiKey: apiKey}, {merge: true});
  return {result: "APIキーを更新しました。"};
});


// --- 部員名簿API ---

exports.getMemberListAPI = onRequest({cors: true}, async (req, res) => {
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
      const data = doc.data();
      return {
        name: data.name,
        furigana: data.furigana || "",
        grade: data.grade || "",
        project: data.project || "",
        status: data.status,
      };
    });

    res.status(200).send(memberList);
  } catch (error) {
    console.error("APIでのFirestoreデータ取得中にエラー:", error);
    res.status(500).send({error: "Internal Server Error"});
  }
});


// --- Discord連携関数 ---

exports.manageDiscordRoles = onDocumentWritten("members/{memberId}", async (event) => {
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

  // ドキュメント削除 or Discord IDなし
  if (!after || !after.discordId) {
    if (before && before.discordId) {
      console.log(`メンバー ${before.name} が削除されたため、ロールを剥奪します。`);
      if (memberRoleId) await discordApi.delete(`/guilds/${serverId}/members/${before.discordId}/roles/${memberRoleId}`).catch((e) => console.error(JSON.stringify(e.response?.data)));
      if (inRoomRoleId) await discordApi.delete(`/guilds/${serverId}/members/${before.discordId}/roles/${inRoomRoleId}`).catch((e) => console.error(JSON.stringify(e.response?.data)));
    }
    return;
  }

  const discordUserId = after.discordId;

  // 「部員」ロール管理
  if (settings.discordMemberRoleEnabled && memberRoleId && (!before || before.isExpired !== after.isExpired)) {
    try {
      if (after.isExpired) {
        console.log(`${after.name} が失効したため、「部員」ロールを剥奪。`);
        await discordApi.delete(`/guilds/${serverId}/members/${discordUserId}/roles/${memberRoleId}`);
      } else {
        console.log(`${after.name} が有効なため、「部員」ロールを付与。`);
        await discordApi.put(`/guilds/${serverId}/members/${discordUserId}/roles/${memberRoleId}`);
      }
    } catch (e) {
      console.error("部員ロール更新失敗:", JSON.stringify(e.response?.data));
    }
  }

  // 「部内」ロール管理
  if (settings.discordInRoomRoleEnabled && inRoomRoleId && (!before || before.status !== after.status)) {
    try {
      if (after.status === "in" && !after.isExpired) {
        console.log(`${after.name} が入室したため、「部内」ロールを付与。`);
        await discordApi.put(`/guilds/${serverId}/members/${discordUserId}/roles/${inRoomRoleId}`);
      } else {
        console.log(`${after.name} が退室または失効したため、「部内」ロールを剥奪。`);
        await discordApi.delete(`/guilds/${serverId}/members/${discordUserId}/roles/${inRoomRoleId}`);
      }
    } catch (e) {
      console.error("部内ロール更新失敗:", JSON.stringify(e.response?.data));
    }
  }
});


// ▼▼▼ 手動同期関数 ▼▼▼
exports.manualSyncDiscordRoles = onCall({cors: true, timeoutSeconds: 300}, async (request) => {
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
      // 自動付与がオフでも、ロールIDがあれば同期する
      if (settings.discordMemberRoleId) {
        if (member.isExpired) {
          await discordApi.delete(`/guilds/${settings.discordServerId}/members/${member.discordId}/roles/${settings.discordMemberRoleId}`);
        } else {
          await discordApi.put(`/guilds/${settings.discordServerId}/members/${member.discordId}/roles/${settings.discordMemberRoleId}`);
        }
      }
      // 自動付与がオフでも、ロールIDがあれば同期する
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

exports.addAdmin = onCall({cors: true}, async (request) => {
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

exports.listAdmins = onCall({cors: true}, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const adminDocs = await db.collection("admins").get();
  const adminUsers = await Promise.all(
      adminDocs.docs.map((doc) => auth.getUser(doc.id).catch(() => null)),
  );
  return adminUsers.filter((user) => user).map((user) => ({uid: user.uid, email: user.email}));
});

exports.updateAdmin = onCall({cors: true}, async (request) => {
  if (!request.auth || !(await db.collection("admins").doc(request.auth.uid).get()).exists) {
    throw new HttpsError("permission-denied", "権限がありません。");
  }
  const {uid, newEmail} = request.data;
  await auth.updateUser(uid, {email: newEmail});
  await db.collection("admins").doc(uid).update({email: newEmail});
  return {result: "管理者のメールアドレスを更新しました。"};
});

exports.deleteAdmin = onCall({cors: true}, async (request) => {
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
