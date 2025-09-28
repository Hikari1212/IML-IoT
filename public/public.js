import { collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

export function initPublicPage(db) {
    const membersCollection = collection(db, 'members');
    const currentMembersDiv = document.getElementById('current-members');

    // 在室者をリアルタイムで表示する機能のみ
    const q = query(membersCollection, where('status', '==', 'in'));

    onSnapshot(q, (snapshot) => {
        if (currentMembersDiv) {
            currentMembersDiv.innerHTML = ''; // 表示を一度リセット
            if (snapshot.empty) {
                currentMembersDiv.innerHTML = '<p>現在誰もいません</p>';
            } else {
                const members = [];
                snapshot.forEach(doc => {
                    members.push(doc.data());
                });

                // 名前でソート
                members.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

                // 表示
                members.forEach(member => {
                    // グリッド用のHTML要素に学年を追加
                    currentMembersDiv.innerHTML += `
                        <div class="member status-in">
                            <div>${member.name}</div>
                            <small class="grade-display">${member.grade || ''}</small>
                        </div>
                    `;
                });
            }
        }
    });
}