import { collection, query, where, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

export function initRegisterPage(db) {
    const registerForm = document.getElementById('register-form');
    const membersCollection = collection(db, 'members');

    // 空きキーを探す関数 (admin.jsから移植)
    async function findNextAvailableKey() {
        const possibleKeys = 'abcdefghijklmnopqrstuvwxyz0123456789-^\\@[;:],./'.split('');
        const q = query(membersCollection); // 全てのメンバーを対象にキーをチェック
        const membersSnapshot = await getDocs(q);
        const usedKeys = new Set();
        membersSnapshot.forEach(doc => {
            if (doc.data().assignedKey) {
                usedKeys.add(doc.data().assignedKey);
            }
        });
        for (const key of possibleKeys) {
            if (!usedKeys.has(key)) {
                return key;
            }
        }
        return null;
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitButton = document.getElementById('submit-button');
            submitButton.disabled = true;
            submitButton.textContent = '登録処理中...';

            const nameInput = document.getElementById('new-member-name').value;
            const studentIdInput = document.getElementById('new-member-studentid').value;

            try {
                // 重複チェック
                const nameCheckQuery = query(membersCollection, where('name', '==', nameInput));
                const studentIdCheckQuery = query(membersCollection, where('studentId', '==', studentIdInput));
                const [nameCheck, studentIdCheck] = await Promise.all([getDocs(nameCheckQuery), getDocs(studentIdCheckQuery)]);

                if (!nameCheck.empty) {
                    alert('エラー: 同じ名前の部員が既に登録されています。');
                    return;
                }
                if (!studentIdCheck.empty) {
                    alert('エラー: 同じ学籍番号の部員が既に登録されています。');
                    return;
                }

                const assignedKey = await findNextAvailableKey();
                if (!assignedKey) {
                    alert('エラー: システムに空きがありません。管理者に連絡してください。');
                    return;
                }

                // Firestoreにデータを追加
                await addDoc(membersCollection, {
                    name: nameInput,
                    furigana: document.getElementById('new-member-furigana').value,
                    studentId: studentIdInput,
                    email: document.getElementById('new-member-email').value,
                    discordId: document.getElementById('new-member-discordid').value,
                    gender: document.getElementById('new-member-gender').value,
                    age: parseInt(document.getElementById('new-member-age').value, 10) || null,
                    grade: document.getElementById('new-member-grade').value,
                    category: document.getElementById('new-member-category').value,
                    project: document.getElementById('new-member-project').value,
                    assignedKey: assignedKey,
                    status: 'out',
                    isExpired: true,      // ★ 必ず失効状態で作成
                    expiryDate: null,       // ★ 有効期限はなし
                    createdAt: serverTimestamp(),
                    lastUpdated: serverTimestamp()
                });
                
                // 成功メッセージ
                const panel = document.getElementById('register-panel');
                panel.innerHTML = `
                    <h2>登録申請が完了しました</h2>
                    <p style="text-align: center;">ご登録ありがとうございます。<br>管理者が内容を確認後、アカウントが有効になります。</p>
                `;

            } catch (error) {
                console.error("登録エラー:", error);
                alert("登録中にエラーが発生しました。");
            } finally {
                if(submitButton) {
                    submitButton.disabled = false;
                    submitButton.textContent = '登録を申請する';
                }
            }
        });
    }
}