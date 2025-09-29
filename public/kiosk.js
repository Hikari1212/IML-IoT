import { collection, query, where, onSnapshot, orderBy, doc, getDoc, getDocs, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

// ▼▼▼ 外部から呼び出せるように export を追加 ▼▼▼
export function initKioskPage(db) {
    const membersCollection = collection(db, 'members');
    const logsCollection = collection(db, 'activity_logs');
    const memberListDiv = document.getElementById('member-list');

    const processingActions = new Set();

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
    
    document.addEventListener('keydown', async (event) => {
        // Enterキーの処理はkiosk.html側で行うため、ここでは何もしない
        if (event.key === 'Enter') return;
        if (event.repeat) return;
        
        // 登録画面が表示されている場合はキー操作を無効にする
        const enrollmentPanel = document.getElementById('enrollment-panel');
        if (enrollmentPanel && enrollmentPanel.style.display !== 'none') {
            return;
        }

        const pressedKey = event.key.toLowerCase();
        try {
            const q = query(membersCollection, where('assignedKey', '==', pressedKey));
            const snapshot = await getDocs(q);

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


// --- ▼▼▼ 画面遷移用の関数を追加 ▼▼▼ ---
export function showKioskPanel() {
    document.getElementById('kiosk-panel').style.display = 'block';
    document.getElementById('enrollment-panel').style.display = 'none';
    const video = document.getElementById('video');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}

export function showEnrollmentPanel() {
    document.getElementById('kiosk-panel').style.display = 'none';
    document.getElementById('enrollment-panel').style.display = 'block';

    // 登録画面が表示されたらカメラを起動
    const event = new CustomEvent('start-camera');
    document.dispatchEvent(event);
}