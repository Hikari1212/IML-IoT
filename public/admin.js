import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-functions.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import {
    collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp,
    deleteDoc, getDocs, writeBatch, Timestamp, orderBy, limit, startAfter
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

export function initAdminPage(auth, db, functions, XLSX) {
    const membersCollection = collection(db, 'members');

    // --- DOM要素 ---
    const loginForm = document.getElementById('login-form');
    const mainContent = document.getElementById('main-content');
    const loginButton = document.getElementById('login-button');
    const logoutLink = document.getElementById('logout-link');
    const addMemberForm = document.getElementById('add-member-form');
    const exportExcelButton = document.getElementById('export-excel-button');
    const excelFileInput = document.getElementById('excel-file-input');
    const importExcelButton = document.getElementById('import-excel-button');
    const downloadTemplateButton = document.getElementById('download-template-button');
    const adminMemberListDiv = document.getElementById('admin-member-list');

    // --- 一括操作のDOM要素 ---
    const bulkActionPanel = document.getElementById('bulk-action-panel');
    const selectionCount = document.getElementById('selection-count');
    const bulkActionSelect = document.getElementById('bulk-action-select');
    const bulkExpirySelect = document.getElementById('bulk-expiry-select');
    const bulkApplyButton = document.getElementById('bulk-apply-button');

    // --- ハンバーガーメニューとパネルのDOM要素 ---
    const hamburgerButton = document.getElementById('hamburger-menu-button');
    const sideNav = document.getElementById('side-nav');
    const navLinkMembers = document.getElementById('nav-link-members');
    const navLinkLogs = document.getElementById('nav-link-logs');
    const memberManagementPanel = document.getElementById('member-management-panel');
    const activityLogPanel = document.getElementById('activity-log-panel');

    // --- 入退室ログ関連のDOM要素と状態変数 ---
    const activityLogListDiv = document.getElementById('activity-log-list');
    const logPeriodSelect = document.getElementById('log-period-select');
    const logPageSizeSelect = document.getElementById('log-page-size-select');
    const logPrevButton = document.getElementById('log-prev-button');
    const logNextButton = document.getElementById('log-next-button');
    const logPageInfo = document.getElementById('log-page-info');
    let logCurrentPage = 1;
    let pageStartMarkers = [null]; // 各ページの開始点(Firestore Document)を格納

    // --- 検索・ソート機能のDOM要素 ---
    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');
    let allMembers = [];

    // --- 管理者管理機能のDOM要素 ---
    const navLinkAdmins = document.getElementById('nav-link-admins');
    const adminManagementPanel = document.getElementById('admin-management-panel');
    const adminListDiv = document.getElementById('admin-list');
    const addAdminForm = document.getElementById('add-admin-form');
    const addAdminButton = document.getElementById('add-admin-button');

    const navLinkDiscord = document.getElementById('nav-link-discord');
    const discordIntegrationPanel = document.getElementById('discord-integration-panel');
    const discordSettingsForm = document.getElementById('discord-settings-form');
    const manualSyncButton = document.getElementById('manual-sync-button');

    const navLinkSettings = document.getElementById('nav-link-settings');
    const settingsPanel = document.getElementById('settings-panel');
    const apiKeyDisplay = document.getElementById('api-key-display');
    const updateApiKeyButton = document.getElementById('update-api-key-button');

    let isDiscordFormDirty = false;

    function navigateWithDirtyCheck(panelToShow) {
        if (isDiscordFormDirty) {
            if (!confirm("未保存の変更があります。ページを移動しますか？")) {
                return; // 移動をキャンセル
            }
        }
        showPanel(panelToShow);
        isDiscordFormDirty = false; // 他のページに移動したらフラグをリセット
    }

    // --- 認証処理 ---
    onAuthStateChanged(auth, user => {
        if (user) {
            loginForm.parentElement.style.display = 'none';
            mainContent.style.display = 'block';
            hamburgerButton.style.display = 'flex';
            loadAdminMemberList();
            setupLogEventListeners(); // ログ画面のイベントリスナーを設定
            loadActivityLogs();       // ログを初期表示
            loadAdminList();
            loadSettings();
        } else {
            loginForm.parentElement.style.display = 'flex';
            mainContent.style.display = 'none';
            hamburgerButton.style.display = 'none';
            sideNav.classList.remove('open');
        }
    });

    loginButton.addEventListener('click', () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        signInWithEmailAndPassword(auth, email, password)
            .catch(error => alert('ログインに失敗しました: ' + error.message));
    });

    logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        signOut(auth);
    });

    // --- ハンバーガーメニュー & パネル切り替え ---
    hamburgerButton.addEventListener('click', () => {
        sideNav.classList.toggle('open');
    });

    function showPanel(panelToShow) {
        if (panelToShow === discordIntegrationPanel || panelToShow === settingsPanel) {
            loadSettings();
        }
        document.querySelectorAll('.content-panel').forEach(panel => panel.style.display = 'none');
        panelToShow.style.display = 'block';
        sideNav.classList.remove('open');
    }

    navLinkMembers.addEventListener('click', (e) => { e.preventDefault(); navigateWithDirtyCheck(memberManagementPanel); });
    navLinkAdmins.addEventListener('click', (e) => { e.preventDefault(); navigateWithDirtyCheck(adminManagementPanel); });
    navLinkLogs.addEventListener('click', (e) => { e.preventDefault(); navigateWithDirtyCheck(activityLogPanel); });
    navLinkSettings.addEventListener('click', (e) => { e.preventDefault(); navigateWithDirtyCheck(settingsPanel); });
    navLinkDiscord.addEventListener('click', (e) => {
        e.preventDefault();
        showPanel(discordIntegrationPanel);
        isDiscordFormDirty = false;
    });

    async function loadSettings() {
        try {
            const getSettings = httpsCallable(functions, 'getSettings');
            const result = await getSettings();
            const settings = result.data || {};

            const memberRoleEnabledCheckbox = document.getElementById('discord-member-role-enabled');
            if (memberRoleEnabledCheckbox) memberRoleEnabledCheckbox.checked = settings.discordMemberRoleEnabled || false;
            const inRoomRoleEnabledCheckbox = document.getElementById('discord-in-room-role-enabled');
            if (inRoomRoleEnabledCheckbox) inRoomRoleEnabledCheckbox.checked = settings.discordInRoomRoleEnabled || false;
            const tokenInput = document.getElementById('discord-token');
            if (tokenInput) tokenInput.value = settings.discordBotToken || '';
            const serverIdInput = document.getElementById('discord-server-id');
            if (serverIdInput) serverIdInput.value = settings.discordServerId || '';
            const memberRoleIdInput = document.getElementById('discord-member-role-id');
            if (memberRoleIdInput) memberRoleIdInput.value = settings.discordMemberRoleId || '';
            const inRoomRoleIdInput = document.getElementById('discord-in-room-role-id');
            if (inRoomRoleIdInput) inRoomRoleIdInput.value = settings.discordInRoomRoleId || '';
            if (apiKeyDisplay) apiKeyDisplay.value = settings.memberApiKey || 'APIキーが設定されていません';
        } catch (error) {
            console.error("設定の読み込みに失敗:", error);
            alert(`設定の読み込みに失敗しました: ${error.message}`);
        }
    }

    // --- Discord連携ページ ---
    discordSettingsForm.addEventListener('input', () => {
        isDiscordFormDirty = true;
    });

    discordSettingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;
        button.textContent = '保存中...';
        const settings = {
            discordMemberRoleEnabled: document.getElementById('discord-member-role-enabled').checked,
            discordInRoomRoleEnabled: document.getElementById('discord-in-room-role-enabled').checked,
            token: document.getElementById('discord-token').value,
            serverId: document.getElementById('discord-server-id').value,
            memberRoleId: document.getElementById('discord-member-role-id').value,
            inRoomRoleId: document.getElementById('discord-in-room-role-id').value,
        };
        try {
            const updateDiscordSettings = httpsCallable(functions, 'updateDiscordSettings');
            await updateDiscordSettings(settings);
            isDiscordFormDirty = false;
            alert('Discord設定を保存しました。');
        } catch (error) {
            alert(`保存に失敗しました: ${error.message}`);
        } finally {
            button.disabled = false;
            button.textContent = 'Discord設定を保存';
        }
    });

    manualSyncButton.addEventListener('click', async () => {
        if (!confirm('全ての部員のDiscordロールを現在の名簿情報に強制的に同期します。よろしいですか？\n(部員数が多い場合、処理に数分かかることがあります)')) return;
        manualSyncButton.disabled = true;
        manualSyncButton.textContent = '同期処理中...';
        try {
            const manualSync = httpsCallable(functions, 'manualSyncDiscordRoles');
            const result = await manualSync();
            alert(result.data.result);
        } catch (error) {
            alert(`同期に失敗しました: ${error.message}`);
        } finally {
            manualSyncButton.disabled = false;
            manualSyncButton.textContent = '今すぐ手動で同期する';
        }
    });

    // --- 設定ページ (APIキー) ---
    updateApiKeyButton.addEventListener('click', async () => {
        if (!confirm('新しいAPIキーを生成しますか？古いキーは上書きされ、使用できなくなります。')) return;
        const generateRandomString = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
        const newApiKey = generateRandomString();
        try {
            const updateApiKey = httpsCallable(functions, 'updateApiKey');
            await updateApiKey({ apiKey: newApiKey });
            apiKeyDisplay.value = newApiKey;
            alert('新しいAPIキーを生成・保存しました。');
        } catch (error) {
            alert(`更新に失敗しました: ${error.message}`);
        }
    });

    // --- 管理者管理機能 ---
    async function loadAdminList() {
        try {
            const listAdmins = httpsCallable(functions, 'listAdmins');
            const result = await listAdmins();
            const admins = result.data;
            adminListDiv.innerHTML = '';
            admins.forEach(admin => {
                const isAdminSelf = admin.uid === auth.currentUser.uid;
                const deleteButtonHtml = isAdminSelf ? '' : `<button class="delete-button" data-uid="${admin.uid}">削除</button>`;
                adminListDiv.innerHTML += `
                    <div class="member" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; padding: 12px 15px;">
                        <span style="word-break: break-all;">${admin.email} ${isAdminSelf ? '<strong>(あなた)</strong>' : ''}</span>
                        <div>${deleteButtonHtml}</div>
                    </div>
                `;
            });
        } catch (error) {
            console.error("管理者一覧の取得に失敗:", error);
            adminListDiv.innerHTML = '<p>管理者一覧の取得に失敗しました。</p>';
        }
    }

    adminListDiv.addEventListener('click', async (e) => {
        const target = e.target;
        const uid = target.dataset.uid;
        if (target.classList.contains('delete-button') && uid) {
            if (confirm('本当にこの管理者を削除しますか？この操作は取り消せません。')) {
                target.disabled = true;
                try {
                    const deleteAdmin = httpsCallable(functions, 'deleteAdmin');
                    await deleteAdmin({ uid });
                    alert('管理者を削除しました。');
                    loadAdminList();
                } catch (error) {
                    alert(`削除に失敗しました: ${error.message}`);
                    target.disabled = false;
                }
            }
        }
    });

    addAdminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('new-admin-email').value;
        const password = document.getElementById('new-admin-password').value;
        if (!confirm(`${email} を新しい管理者として登録しますか？`)) return;
        addAdminButton.disabled = true;
        addAdminButton.textContent = '登録処理中...';
        try {
            const addAdminFunction = httpsCallable(functions, 'addAdmin');
            const result = await addAdminFunction({ email, password });
            alert(result.data.result);
            addAdminForm.reset();
            loadAdminList();
        } catch (error) {
            console.error('管理者登録エラー:', error);
            alert(`エラーが発生しました: ${error.message}`);
        } finally {
            addAdminButton.disabled = false;
            addAdminButton.textContent = '管理者として登録';
        }
    });

    // --- 部員管理機能 ---
    function loadAdminMemberList() {
        const q = query(membersCollection);
        onSnapshot(q, (snapshot) => {
            const now = new Date();
            allMembers = [];
            const updates = [];
            snapshot.forEach(docSnap => {
                const member = docSnap.data();
                const memberId = docSnap.id;
                let isExpired = member.isExpired;
                if (member.expiryDate && member.expiryDate.toDate() < now && !isExpired) {
                    updates.push(updateDoc(doc(db, 'members', memberId), { isExpired: true }));
                    isExpired = true;
                }
                allMembers.push({ id: memberId, ...member, isExpired });
            });
            if (updates.length > 0) {
                Promise.all(updates).then(() => console.log(`${updates.length}件のメンバーを失効に更新しました。`));
            }
            renderMemberList();
        });
    }

    function renderMemberList() {
        const searchTerm = searchInput.value.toLowerCase();
        const sortOption = sortSelect.value;
        let filteredMembers = allMembers.filter(member => {
            if (!searchTerm) return true;
            const name = member.name.toLowerCase();
            const furigana = (member.furigana || '').toLowerCase();
            const grade = (member.grade || '').toLowerCase();
            const project = (member.project || '').toLowerCase();
            const age = member.age ? member.age.toString() : '';
            return name.includes(searchTerm) || furigana.includes(searchTerm) || grade.includes(searchTerm) || project.includes(searchTerm) || age.includes(searchTerm);
        });
        filteredMembers.sort((a, b) => {
            const gradeOrder = { 'B1': 1, 'B2': 2, 'B3': 3, 'B4': 4, 'M1': 5, 'M2': 6 };
            switch (sortOption) {
                case 'name-asc': return (a.furigana || a.name).localeCompare(b.furigana || b.name, 'ja');
                case 'name-desc': return (b.furigana || b.name).localeCompare(a.furigana || a.name, 'ja');
                case 'grade-asc': return (gradeOrder[a.grade] || 99) - (gradeOrder[b.grade] || 99);
                case 'grade-desc': return (gradeOrder[b.grade] || 0) - (gradeOrder[a.grade] || 0);
                case 'age-asc': return (a.age || 999) - (b.age || 999);
                case 'age-desc': return (b.age || 0) - (a.age || 0);
                case 'project-asc': return (a.project || '').localeCompare(b.project || '', 'ja');
                case 'expiry-asc':
                    const expiryA = a.expiryDate ? a.expiryDate.toDate() : new Date('2999-12-31');
                    const expiryB = b.expiryDate ? b.expiryDate.toDate() : new Date('2999-12-31');
                    return expiryA - expiryB;
                case 'status':
                    if (a.status === 'in' && b.status !== 'in') return -1;
                    if (a.status !== 'in' && b.status === 'in') return 1;
                    return (a.furigana || a.name).localeCompare(b.furigana || b.name, 'ja');
                default: return 0;
            }
        });
        adminMemberListDiv.innerHTML = `<div class="member-header"><input type="checkbox" id="select-all-checkbox"><span>メンバー情報</span></div>`;
        if (filteredMembers.length === 0) {
            adminMemberListDiv.innerHTML += '<p style="text-align: center; padding: 20px;">該当する部員はいません。</p>';
            updateSelection();
            return;
        }
        const checkedIds = new Set(Array.from(document.querySelectorAll('.member-checkbox:checked')).map(cb => cb.dataset.id));
        filteredMembers.forEach(member => {
            const statusText = member.isExpired ? '失効' : (member.status === 'in' ? '在室中' : '不在');
            const memberClass = member.isExpired ? 'member expired' : 'member';
            const expiryDateStr = member.expiryDate ? member.expiryDate.toDate().toLocaleDateString('ja-JP') : '期限なし';
            const isChecked = checkedIds.has(member.id) ? 'checked' : '';
            const html = `
                <div class="${memberClass}" id="member-item-${member.id}">
                    <div class="member-summary">
                         <input type="checkbox" class="member-checkbox" data-id="${member.id}" ${isChecked}>
                        <div class="summary-info">
                            <strong>${member.name}</strong> <small>(${member.furigana || 'フリガナ未設定'})</small>
                        </div>
                        <div class="summary-status">
                            <span class="expiry-date">期限: ${expiryDateStr}</span>
                            <span class="status-text">${statusText}</span>
                        </div>
                        <div class="summary-actions">
                             <button class="edit-button" data-id="${member.id}">編集</button>
                             <button class="delete-button" data-id="${member.id}">削除</button>
                        </div>
                    </div>
                    <div class="member-details">
                        <hr>
                        <p><strong>学籍番号:</strong> ${member.studentId || '未設定'}</p>
                        <p><strong>Discord ID:</strong> ${member.discordId || '未設定'}</p>
                        <p><strong>メールアドレス:</strong> ${member.email || '未登録'}</p>
                        <p><strong>所属プロジェクト:</strong> ${member.project || '未定'}</p>
                        <p><strong>その他:</strong> キー[${member.assignedKey}] / ${member.gender || ''} / ${member.grade || ''} / ${member.category || ''} / ${member.age || '?'}歳</p>
                    </div>
                    <div class="edit-view" style="display:none;">
                        <div class="edit-form">
                            <input type="text" id="edit-name-${member.id}" value="${member.name}" placeholder="名前">
                            <input type="text" id="edit-furigana-${member.id}" value="${member.furigana || ''}" placeholder="読み仮名">
                            <input type="text" id="edit-studentid-${member.id}" value="${member.studentId || ''}" placeholder="学籍番号" pattern="[0-9]{7}" maxlength="7">
                            <input type="email" id="edit-email-${member.id}" value="${member.email || ''}" placeholder="メールアドレス">
                            <input type="text" id="edit-discordid-${member.id}" value="${member.discordId || ''}" placeholder="DiscordユーザーID" pattern="^\\d{17,19}$" title="DiscordユーザーIDは17桁から19桁の数字で入力してください。">
                            <select id="edit-gender-${member.id}"><option value="男性" ${member.gender === '男性' ? 'selected' : ''}>男性</option><option value="女性" ${member.gender === '女性' ? 'selected' : ''}>女性</option><option value="その他" ${member.gender === 'その他' ? 'selected' : ''}>その他</option></select>
                            <input type="number" id="edit-age-${member.id}" value="${member.age || ''}" placeholder="年齢">
                            <select id="edit-grade-${member.id}"><option value="B1" ${member.grade === 'B1' ? 'selected' : ''}>学部1年</option><option value="B2" ${member.grade === 'B2' ? 'selected' : ''}>学部2年</option><option value="B3" ${member.grade === 'B3' ? 'selected' : ''}>学部3年</option><option value="B4" ${member.grade === 'B4' ? 'selected' : ''}>学部4年</option><option value="M1" ${member.grade === 'M1' ? 'selected' : ''}>修士1年</option><option value="M2" ${member.grade === 'M2' ? 'selected' : ''}>修士2年</option></select>
                            <select id="edit-category-${member.id}"><option value="Ⅰ類" ${member.category === 'Ⅰ類' ? 'selected' : ''}>Ⅰ類</option><option value="Ⅱ類" ${member.category === 'Ⅱ類' ? 'selected' : ''}>Ⅱ類</option><option value="Ⅲ類" ${member.category === 'Ⅲ類' ? 'selected' : ''}>Ⅲ類</option></select>
                            <input type="text" id="edit-project-${member.id}" value="${member.project || ''}" placeholder="プロジェクト">
                            <select id="edit-expiry-${member.id}"><option value="">有効期限を変更しない</option><option value="this-october">今年の10月末</option><option value="next-april">来年の4月末</option><option value="expire-now">失効させる</option></select>
                        </div>
                        <div class="edit-controls" style="text-align: right; margin-top: 10px;">
                            <button class="save-button" data-id="${member.id}">保存</button>
                            <button class="cancel-button" data-id="${member.id}">キャンセル</button>
                        </div>
                    </div>
                </div>`;
            adminMemberListDiv.innerHTML += html;
        });
        updateSelection();
    }

    searchInput.addEventListener('input', renderMemberList);
    sortSelect.addEventListener('change', renderMemberList);

    addMemberForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('new-member-name');
        const studentIdInput = document.getElementById('new-member-studentid');
        const nameCheckQuery = query(membersCollection, where('name', '==', nameInput.value));
        const nameCheck = await getDocs(nameCheckQuery);
        if (!nameCheck.empty) { alert('エラー: 同じ名前の部員が既に登録されています。'); return; }
        const studentIdCheckQuery = query(membersCollection, where('studentId', '==', studentIdInput.value));
        const studentIdCheck = await getDocs(studentIdCheckQuery);
        if (!studentIdCheck.empty) { alert('エラー: 同じ学籍番号の部員が既に登録されています。'); return; }
        const assignedKey = await findNextAvailableKey();
        if (!assignedKey) { alert('エラー: 割り当て可能なキーがありません。'); return; }
        const expiryChoice = document.getElementById('new-member-expiry').value;
        const expiryDate = getExpiryDate(expiryChoice);
        if (!expiryDate) { alert('有効期限を選択してください。'); return; }
        await addDoc(membersCollection, {
            name: nameInput.value,
            furigana: document.getElementById('new-member-furigana').value,
            studentId: studentIdInput.value,
            email: document.getElementById('new-member-email').value,
            discordId: document.getElementById('new-member-discordid').value,
            gender: document.getElementById('new-member-gender').value,
            assignedKey: assignedKey,
            age: parseInt(document.getElementById('new-member-age').value, 10) || null,
            grade: document.getElementById('new-member-grade').value,
            category: document.getElementById('new-member-category').value,
            project: document.getElementById('new-member-project').value,
            status: 'out',
            expiryDate: Timestamp.fromDate(expiryDate),
            isExpired: false,
            createdAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
        });
        addMemberForm.reset();
        alert(`${nameInput.value} さんを追加しました (キー: ${assignedKey})`);
    });

    document.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.matches('.member-checkbox, #select-all-checkbox')) return;
        const memberItem = target.closest('.member');
        if (!memberItem || !memberItem.id.startsWith('member-item-')) return;
        const id = memberItem.id.replace('member-item-', '');
        const summaryView = memberItem.querySelector('.member-summary');
        const detailsView = memberItem.querySelector('.member-details');
        const editView = memberItem.querySelector('.edit-view');
        if (target.classList.contains('edit-button')) {
            summaryView.style.display = 'none';
            detailsView.style.display = 'none';
            editView.style.display = 'block';
            memberItem.classList.remove('is-open');
            return;
        }
        if (target.classList.contains('cancel-button')) {
            summaryView.style.display = 'flex';
            editView.style.display = 'none';
            detailsView.style.removeProperty('display');
            return;
        }
        if (target.classList.contains('save-button')) {
            const memberDocRef = doc(db, 'members', id);
            const updatedData = {
                name: document.getElementById(`edit-name-${id}`).value,
                furigana: document.getElementById(`edit-furigana-${id}`).value,
                studentId: document.getElementById(`edit-studentid-${id}`).value,
                email: document.getElementById(`edit-email-${id}`).value,
                discordId: document.getElementById(`edit-discordid-${id}`).value,
                gender: document.getElementById(`edit-gender-${id}`).value,
                age: parseInt(document.getElementById(`edit-age-${id}`).value, 10) || null,
                grade: document.getElementById(`edit-grade-${id}`).value,
                category: document.getElementById(`edit-category-${id}`).value,
                project: document.getElementById(`edit-project-${id}`).value,
                lastUpdated: serverTimestamp()
            };
            const expiryChoice = document.getElementById(`edit-expiry-${id}`).value;
            if (expiryChoice) {
                if (expiryChoice === 'expire-now') {
                    updatedData.isExpired = true;
                    updatedData.expiryDate = null;
                } else {
                    const newExpiryDate = getExpiryDate(expiryChoice);
                    if (newExpiryDate) {
                        updatedData.expiryDate = Timestamp.fromDate(newExpiryDate);
                        updatedData.isExpired = false;
                    }
                }
            }
            await updateDoc(memberDocRef, updatedData);
            alert('メンバー情報を更新しました。');
            return;
        }
        if (target.classList.contains('delete-button')) {
            if (confirm('本当にこの部員を削除しますか？')) {
                await deleteDoc(doc(db, 'members', id));
                alert('部員を削除しました。');
            }
            return;
        }
        memberItem.classList.toggle('is-open');
    });

    function getExpiryDate(choice) {
        const now = new Date();
        let year = now.getFullYear();
        let month, day;
        if (choice === 'this-october') { month = 9; day = 31; }
        else if (choice === 'next-april') { year += 1; month = 3; day = 30; }
        else { return null; }
        return new Date(year, month, day, 23, 59, 59);
    }

    async function findNextAvailableKey(extraUsedKeys = new Set()) {
        const possibleKeys = 'abcdefghijklmnopqrstuvwxyz0123456789-^\\@[;:],./'.split('');
        const q = query(membersCollection, where('isExpired', '!=', true));
        const membersSnapshot = await getDocs(q);
        const usedKeys = new Set(extraUsedKeys);
        membersSnapshot.forEach(docSnap => {
            if (docSnap.data().assignedKey) { usedKeys.add(docSnap.data().assignedKey); }
        });
        for (const key of possibleKeys) {
            if (!usedKeys.has(key)) { return key; }
        }
        return null;
    }

    function updateSelection() {
        const memberCheckboxes = document.querySelectorAll('.member-checkbox');
        const selectedCheckboxes = document.querySelectorAll('.member-checkbox:checked');
        const count = selectedCheckboxes.length;
        selectionCount.textContent = `${count}件選択中`;
        bulkActionPanel.style.display = (count > 0) ? 'block' : 'none';
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = (count > 0 && memberCheckboxes.length > 0 && count === memberCheckboxes.length);
        }
    }

    document.addEventListener('change', (e) => {
        if (e.target.id === 'select-all-checkbox') {
            const isChecked = e.target.checked;
            document.querySelectorAll('.member-checkbox').forEach(cb => { cb.checked = isChecked; });
        }
        if (e.target.classList.contains('member-checkbox') || e.target.id === 'select-all-checkbox') {
            updateSelection();
        }
    });

    bulkActionSelect.addEventListener('change', () => {
        bulkExpirySelect.style.display = (bulkActionSelect.value === 'update-expiry') ? 'inline-block' : 'none';
    });

    bulkApplyButton.addEventListener('click', async () => {
        const selectedIds = Array.from(document.querySelectorAll('.member-checkbox:checked')).map(cb => cb.dataset.id);
        const action = bulkActionSelect.value;
        if (selectedIds.length === 0) { alert('操作対象の部員が選択されていません。'); return; }
        if (!action) { alert('一括操作を選択してください。'); return; }
        const batch = writeBatch(db);

        if (action === 'delete') {
            if (!confirm(`選択した ${selectedIds.length} 件の部員を本当に削除しますか？`)) return;
            selectedIds.forEach(id => batch.delete(doc(db, 'members', id)));
            await batch.commit();
            alert(`${selectedIds.length} 件の部員を削除しました。`);
        } else if (action === 'update-expiry') {
            const choice = bulkExpirySelect.value;
            if (!choice) { alert('更新後の有効期限を選択してください。'); return; }
            if (!confirm(`選択した ${selectedIds.length} 件の部員の有効期限を更新しますか？`)) return;
            if (choice === 'expire-now') {
                selectedIds.forEach(id => {
                    batch.update(doc(db, 'members', id), { isExpired: true, expiryDate: null });
                });
            } else {
                const newExpiryDate = getExpiryDate(choice);
                selectedIds.forEach(id => {
                    batch.update(doc(db, 'members', id), {
                        expiryDate: Timestamp.fromDate(newExpiryDate),
                        isExpired: false
                    });
                });
            }
            await batch.commit();
            alert(`${selectedIds.length} 件の部員の有効期限を更新しました。`);
        }
        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        renderMemberList();
    });

    const exampleRow = {
        '名前(必須)': '電通 太郎',
        'フリガナ(必須)': 'デンツウ タロウ',
        '学籍番号(必須)': '2500001',
        'メールアドレス(必須)': 'taro.dentsu@example.com',
        'DiscordユーザーID(必須)': '1234567890123456789',
        '性別': '男性',
        '年齢': 20,
        '学年': 'B3',
        '類': 'Ⅱ類',
        '所属プロジェクト': 'IMLプロジェクト'
    };

    const templateHeaders = Object.keys(exampleRow);

    downloadTemplateButton.addEventListener('click', () => {
        const worksheet = XLSX.utils.json_to_sheet([exampleRow], { header: templateHeaders });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '部員テンプレート');
        XLSX.writeFile(workbook, '部員情報テンプレート.xlsx');
    });

    const exportHeaders = [
        '名前', 'フリガナ', '学籍番号', 'メールアドレス', 'DiscordユーザーID',
        '性別', '年齢', '学年', '類', '所属プロジェクト',
        '割り当てキー', 'ステータス', '有効期限', '失効'
    ];

    importExcelButton.addEventListener('click', async () => {
        const file = excelFileInput.files[0];
        if (!file) return alert('ファイルを選択してください。');
        importExcelButton.disabled = true;
        importExcelButton.textContent = '処理中...';
        try {
            const existingSnapshot = await getDocs(membersCollection);
            const existingNames = new Set(existingSnapshot.docs.map(doc => doc.data().name));
            const existingStudentIds = new Set(existingSnapshot.docs.map(doc => doc.data().studentId));
            const reader = new FileReader();
            reader.onload = async (event) => {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const membersToImport = XLSX.utils.sheet_to_json(worksheet);

                const batch = writeBatch(db);
                const newKeys = new Set();
                let addedCount = 0;
                let duplicateCount = 0;
                let missingFieldsCount = 0;

                for (const member of membersToImport) {
                    const name = member['名前(必須)'];
                    const furigana = member['フリガナ(必須)'];
                    const studentId = String(member['学籍番号(必須)'] || '');
                    const email = member['メールアドレス(必須)'];
                    const discordId = String(member['DiscordユーザーID(必須)'] || '');
                    
                    if (!name || !furigana || !studentId || !email || !discordId) {
                        missingFieldsCount++;
                        continue;
                    }
                    if (existingNames.has(name) || existingStudentIds.has(studentId)) {
                        duplicateCount++;
                        continue;
                    }

                    const assignedKey = await findNextAvailableKey(newKeys);
                    if (!assignedKey) { alert('空きキーがなくなったため、処理を中断しました。'); break; }
                    newKeys.add(assignedKey);

                    const newMemberRef = doc(membersCollection);
                    batch.set(newMemberRef, {
                        name: name,
                        furigana: furigana,
                        studentId: studentId,
                        email: email,
                        discordId: discordId,
                        gender: member['性別'] || '',
                        age: parseInt(member['年齢'], 10) || null,
                        grade: member['学年'] || '',
                        category: member['類'] || '',
                        project: member['所属プロジェクト'] || '',
                        assignedKey: assignedKey,
                        status: 'out',
                        isExpired: false,
                        expiryDate: null,
                        createdAt: serverTimestamp(),
                        lastUpdated: serverTimestamp()
                    });
                    addedCount++;
                }
                await batch.commit();
                alert(
                    `インポート完了。\n` +
                    `追加: ${addedCount}件\n` +
                    `スキップ(重複): ${duplicateCount}件\n` +
                    `スキップ(必須項目不足): ${missingFieldsCount}件`
                );
                excelFileInput.value = '';
            };
            reader.readAsArrayBuffer(file);
        } catch (error) {
            console.error("Excelインポートエラー:", error);
            alert('ファイルの処理中にエラーが発生しました。');
        } finally {
            importExcelButton.disabled = false;
            importExcelButton.textContent = 'インポート実行';
        }
    });

    exportExcelButton.addEventListener('click', async () => {
        if (allMembers.length === 0) return alert('エクスポートするデータがありません。');
        const dataForExport = allMembers.map(member => ({
            '名前': member.name,
            'フリガナ': member.furigana,
            '学籍番号': member.studentId,
            'メールアドレス': member.email,
            'DiscordユーザーID': member.discordId,
            '性別': member.gender,
            '年齢': member.age,
            '学年': member.grade,
            '類': member.category,
            '所属プロジェクト': member.project,
            '割り当てキー': member.assignedKey,
            'ステータス': member.isExpired ? '失効' : (member.status === 'in' ? '在室' : '不在'),
            '有効期限': member.expiryDate ? member.expiryDate.toDate().toLocaleDateString('ja-JP') : '',
            '失効': member.isExpired
        }));
        const worksheet = XLSX.utils.json_to_sheet(dataForExport, { header: exportHeaders });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '部員情報');
        XLSX.writeFile(workbook, '部員情報.xlsx');
    });

    // --- 入退室ログ機能 ---
    async function loadActivityLogs() {
        if (!auth.currentUser) return;

        logPrevButton.disabled = true;
        logNextButton.disabled = true;
        activityLogListDiv.innerHTML = '<p>ログを読み込んでいます...</p>';

        const docsPerPage = parseInt(logPageSizeSelect.value, 10);
        const period = logPeriodSelect.value;
        const logsCollection = collection(db, 'activity_logs');
        let q = query(logsCollection, orderBy('timestamp', 'desc'));

        // 期間フィルタ
        const now = new Date();
        let startDate;
        if (period === '1m') startDate = new Date(now.setMonth(now.getMonth() - 1));
        else if (period === '3m') startDate = new Date(now.setMonth(now.getMonth() - 3));
        else if (period === '1y') startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        if (startDate) {
            q = query(q, where('timestamp', '>=', Timestamp.fromDate(startDate)));
        }

        // ページネーション
        const startAfterDoc = pageStartMarkers[logCurrentPage - 1];
        if (startAfterDoc) {
            q = query(q, startAfter(startAfterDoc));
        }
        q = query(q, limit(docsPerPage + 1));

        try {
            const snapshot = await getDocs(q);
            const docs = snapshot.docs;
            let hasNextPage = false;
            if (docs.length > docsPerPage) {
                hasNextPage = true;
                docs.pop();
            }

            // 次のページの開始点を記録
            if (docs.length > 0) {
                pageStartMarkers[logCurrentPage] = docs[docs.length - 1];
            }

            logPrevButton.disabled = logCurrentPage <= 1;
            logNextButton.disabled = !hasNextPage;
            logPageInfo.textContent = `ページ ${logCurrentPage}`;

            // ログの描画
            activityLogListDiv.innerHTML = '';
            if (snapshot.empty) {
                activityLogListDiv.innerHTML = '<p>該当するログはありません。</p>';
                return;
            }
            docs.forEach(docSnap => {
                const log = docSnap.data();
                const timestamp = log.timestamp ? log.timestamp.toDate() : new Date();
                const formattedTime = `${timestamp.getFullYear()}/${String(timestamp.getMonth() + 1).padStart(2, '0')}/${String(timestamp.getDate()).padStart(2, '0')} ${String(timestamp.getHours()).padStart(2, '0')}:${String(timestamp.getMinutes()).padStart(2, '0')}`;
                const actionText = log.action === 'in' ? '入室' : '退室';
                const actionClass = log.action === 'in' ? 'log-action-in' : 'log-action-out';
                activityLogListDiv.innerHTML += `
                    <div class="log-item">
                        <div><strong>${log.memberName || '（名前不明）'}</strong> さんが <span class="${actionClass}">${actionText}</span> しました</div>
                        <div class="log-time">${formattedTime}</div>
                    </div>
                `;
            });
        } catch (error) {
            console.error("ログの読み込みに失敗しました: ", error);
            activityLogListDiv.innerHTML = `<p>エラーによりログを読み込めませんでした: ${error.message}</p>`;
        }
    }

    function setupLogEventListeners() {
        const handleFilterChange = () => {
            logCurrentPage = 1;
            pageStartMarkers = [null];
            loadActivityLogs();
        };

        logPeriodSelect.addEventListener('change', handleFilterChange);
        logPageSizeSelect.addEventListener('change', handleFilterChange);

        logNextButton.addEventListener('click', () => {
            if (!logNextButton.disabled) {
                logCurrentPage++;
                loadActivityLogs();
            }
        });

        logPrevButton.addEventListener('click', () => {
            if (!logPrevButton.disabled) {
                logCurrentPage--;
                loadActivityLogs();
            }
        });
    }
}