// kiosk.js の全内容をこのコードに置き換えてください

import { collection, query, where, onSnapshot, orderBy, doc, getDoc, getDocs, updateDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

export function initKioskPage(db) {
    // --- DOM要素と定数の定義 ---
    const membersCollection = collection(db, 'members');
    const logsCollection = collection(db, 'activity_logs');
    const memberListDiv = document.getElementById('member-list');
    const startFaceEnrollmentButton = document.getElementById('start-face-enrollment-flow-button');

    // --- 状態管理用の変数 ---
    const processingActions = new Set();
    let currentMemberCount = 0;

    // --- ヘルパー関数 (initKioskPageスコープ内に配置) ---

    // レイアウトを更新する関数
    function updateGridLayout(numMembers) {
        if (!memberListDiv || numMembers === 0) {
            if (memberListDiv) memberListDiv.style.gridTemplateColumns = '1fr';
            return;
        }
        currentMemberCount = numMembers;
        const containerWidth = memberListDiv.clientWidth;
        const containerHeight = memberListDiv.clientHeight;
        if (containerHeight === 0) return; // 画面非表示時は計算しない
        const aspectRatio = containerWidth / containerHeight;
        const cols = Math.ceil(Math.sqrt(numMembers * aspectRatio));
        memberListDiv.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }

    // 部員のステータスを更新する関数
    async function toggleMemberStatus(docId) {
        if (processingActions.has(docId)) return;
        processingActions.add(docId);
        try {
            const docRef = doc(db, 'members', docId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const member = docSnap.data();
                if (member.isExpired) return;
                
                const newStatus = member.status === 'in' ? 'out' : 'in';
                await updateDoc(docRef, {
                    status: newStatus,
                    lastUpdated: serverTimestamp()
                });
                await addDoc(logsCollection, {
                    memberId: docId,
                    memberName: member.name,
                    action: newStatus,
                    timestamp: serverTimestamp()
                });
            }
        } catch (error) {
            console.error("DB更新エラー:", error);
        } finally {
            setTimeout(() => {
                processingActions.delete(docId);
            }, 1000);
        }
    }

    // --- イベントリスナーとデータ監視のセットアップ ---

    // Firestoreのデータ変更を監視
    const q = query(membersCollection, orderBy('name'));
    onSnapshot(q, (snapshot) => {
        if (!memberListDiv) return;

        const activeMembers = [];
        snapshot.forEach(doc => {
            if (!doc.data().isExpired) {
                activeMembers.push({ id: doc.id, ...doc.data() });
            }
        });

        const memberCountHasChanged = activeMembers.length !== currentMemberCount;

        memberListDiv.innerHTML = '';
        activeMembers.forEach(member => {
            const statusClass = member.status === 'in' ? 'status-in' : 'status-out';
            memberListDiv.innerHTML += `
                <div class="member ${statusClass}" data-id="${member.id}" style="cursor: pointer;">
                    <div>${member.name}</div>
                    <small>(${member.assignedKey})</small>
                </div>`;
        });
        
        if (memberCountHasChanged) {
            updateGridLayout(activeMembers.length);
        }
    });

    // クリックイベント
    if (memberListDiv) {
        memberListDiv.addEventListener('click', (event) => {
            const memberDiv = event.target.closest('.member');
            if (memberDiv && memberDiv.dataset.id) {
                toggleMemberStatus(memberDiv.dataset.id);
            }
        });
    }
    
    // キーボードイベント
    document.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter' || event.repeat) return;
        const enrollmentPanel = document.getElementById('enrollment-panel');
        if (enrollmentPanel && enrollmentPanel.style.display !== 'none') return;

        try {
            const q = query(membersCollection, where('assignedKey', '==', event.key.toLowerCase()));
            const snapshot = await getDocs(q);
            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                if (!doc.data().isExpired) {
                    toggleMemberStatus(doc.id);
                }
            }
        } catch (error) {
            console.error("DB検索エラー:", error);
        }
    });

    // 顔登録ボタンのイベントリスナー
    if (startFaceEnrollmentButton) {
        startFaceEnrollmentButton.addEventListener('click', (e) => {
            e.preventDefault();
            showEnrollmentPanel();
        });
    }

    // ウィンドウリサイズイベント
    window.addEventListener('resize', () => {
        updateGridLayout(currentMemberCount);
    });
}

// --- 画面遷移用の関数 ---
export function showKioskPanel() {
    document.getElementById('kiosk-panel').style.display = 'block';
    document.getElementById('enrollment-panel').style.display = 'none';
    const video = document.getElementById('video');
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
}

export function showEnrollmentPanel() {
    document.getElementById('kiosk-panel').style.display = 'none';
    document.getElementById('enrollment-panel').style.display = 'block';
    const event = new CustomEvent('start-camera');
    document.dispatchEvent(event);
}