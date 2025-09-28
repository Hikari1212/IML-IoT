import { collection, query, where, onSnapshot, orderBy, doc, getDoc, getDocs, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

export function initKioskPage(db) {
    const membersCollection = collection(db, 'members');
    const logsCollection = collection(db, 'activity_logs');
    const memberListDiv = document.getElementById('member-list');

    // 処理中の操作を管理するSet（ドキュメントIDを格納）
    const processingActions = new Set();

    /**
     * 指定された部員のステータスを切り替える関数
     * @param {string} docId - 部員のドキュメントID
     */
    async function toggleMemberStatus(docId) {
        if (processingActions.has(docId)) {
            console.log("処理中のため無視:", docId);
            return;
        }

        processingActions.add(docId);
        console.log("処理開始:", docId);

        try {
            const docRef = doc(db, 'members', docId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const member = docSnap.data();
                if (member.isExpired) {
                    console.log("失効メンバーのため処理をスキップ:", member.name);
                    return;
                }
                const currentStatus = member.status;
                const newStatus = currentStatus === 'in' ? 'out' : 'in';

                await updateDoc(docRef, {
                    status: newStatus,
                    lastUpdated: serverTimestamp()
                });
                console.log("更新完了:", member.name, newStatus);

                await addDoc(logsCollection, {
                    memberId: docId,
                    memberName: member.name,
                    action: newStatus,
                    timestamp: serverTimestamp()
                });
                console.log(`ログ記録: ${member.name} さんが ${newStatus === 'in' ? '入室' : '退室'}`);
            }
        } catch (error) {
            console.error("DB更新エラー:", error);
        } finally {
            setTimeout(() => {
                processingActions.delete(docId);
                console.log("ロック解除:", docId);
            }, 1000);
        }
    }

    // --- メンバー一覧をリアルタイムで表示 ---
    const q = query(membersCollection, orderBy('name'));
    onSnapshot(q, (snapshot) => {
        if (!memberListDiv) return;

        memberListDiv.innerHTML = '';
        snapshot.forEach(doc => {
            const member = doc.data();
            if (!member.isExpired) {
                const statusClass = member.status === 'in' ? 'status-in' : 'status-out';
                memberListDiv.innerHTML += `
                    <div class="member ${statusClass}" data-id="${doc.id}" style="cursor: pointer;">
                        <div>${member.name}</div>
                        <small>(${member.assignedKey})</small>
                    </div>
                `;
            }
        });
    });


    // --- クリックまたはタップ操作のリスナー ---
    if (memberListDiv) {
        memberListDiv.addEventListener('click', (event) => {
            const memberDiv = event.target.closest('.member');
            if (memberDiv) {
                const docId = memberDiv.dataset.id;
                if (docId) {
                    toggleMemberStatus(docId);
                }
            }
        });
    }


    // --- キーボード操作のリスナー ---
    document.addEventListener('keydown', async (event) => {
        if (event.repeat) return;
        const pressedKey = event.key.toLowerCase();
        try {
            const q = query(membersCollection, where('assignedKey', '==', pressedKey));
            const snapshot = await getDocs(q); // このgetDocsが定義されていなかった

            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                const member = doc.data();

                if (member.isExpired) {
                    console.log("失効メンバーのため処理をスキップ:", member.name);
                    return;
                }
                toggleMemberStatus(doc.id);
            } else {
                console.log("該当メンバーなし:", pressedKey);
            }
        } catch (error) {
            console.error("DB検索エラー:", error);
        }
    });
}