import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-functions.js";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import {
    collection, onSnapshot, query, where, doc, updateDoc, addDoc, serverTimestamp,
    deleteDoc, getDocs, writeBatch, Timestamp, orderBy, limit, startAfter
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

export function initAdminPage(auth, db, functions, XLSX, Chart) {
    const membersCollection = collection(db, 'members');

    // --- DOM要素 ---
    const loginForm = document.getElementById('login-form');
    const mainContent = document.getElementById('main-content');
    const loginButton = document.getElementById('login-button');
    const logoutLink = document.getElementById('logout-link');
    const addMemberForm = document.getElementById('add-member-form');
    const adminMemberListDiv = document.getElementById('admin-member-list');
    const homeButton = document.getElementById('home-button'); 
    
    // --- Excel関連DOM要素 ---
    const excelFileInput = document.getElementById('excel-file-input');
    const importExcelButton = document.getElementById('import-excel-button');
    const downloadTemplateButton = document.getElementById('download-template-button');
    const exportExcelButton = document.getElementById('export-excel-button');
    const exportOptionsModal = document.getElementById('export-options-modal');
    const executeExportButton = document.getElementById('execute-export-button');
    const cancelExportButton = document.getElementById('cancel-export-button');
    const exportColumnSelectionDiv = document.getElementById('export-column-selection');
    const exportExcludeExpiredCheckbox = document.getElementById('export-exclude-expired');

    // --- トークン表示モーダル ---
    const tokenDisplayModal = document.getElementById('token-display-modal');
    const tokenDisplayText = document.getElementById('token-display-text');
    const closeTokenModalButton = document.getElementById('close-token-modal-button');

    // --- 一括操作のDOM要素 ---
    const bulkActionPanel = document.getElementById('bulk-action-panel');
    const selectionCount = document.getElementById('selection-count');
    const bulkActionSelect = document.getElementById('bulk-action-select');
    const bulkExpiryControls = document.getElementById('bulk-expiry-controls');
    const bulkExpirySelect = document.getElementById('bulk-expiry-select');
    const bulkCustomExpiryInput = document.getElementById('bulk-custom-expiry');
    const bulkApplyButton = document.getElementById('bulk-apply-button');

    // --- ハンバーガーメニューとパネルのDOM要素 ---
    const hamburgerButton = document.getElementById('hamburger-menu-button');
    const sideNav = document.getElementById('side-nav');
    const navLinkAllFeatures = document.getElementById('nav-link-all-features');
    const navLinkMembers = document.getElementById('nav-link-members');
    const navLinkLogs = document.getElementById('nav-link-logs');
    const navLinkHelp = document.getElementById('nav-link-help');
    const allFeaturesPanel = document.getElementById('all-features-panel');
    const memberManagementPanel = document.getElementById('member-management-panel');
    const activityLogPanel = document.getElementById('activity-log-panel');
    const helpPanel = document.getElementById('help-panel');
    const apiKeyPanel = document.getElementById('api-key-panel');
    const biometricEnrollmentPanel = document.getElementById('biometric-enrollment-panel');
    const biometricMemberSelect = document.getElementById('biometric-member-select');
    const registerFingerprintButton = document.getElementById('register-fingerprint-button');
    const registerFaceButton = document.getElementById('register-face-button');


    // --- 分析ページ関連 ---
    const navLinkAnalytics = document.getElementById('nav-link-analytics');
    const analyticsPanel = document.getElementById('analytics-panel');
    let stayDurationChart = null;
    let entryCountChart = null;
    let analyticsDataLoaded = false;

    // --- 入退室ログ関連 ---
    const activityLogListDiv = document.getElementById('activity-log-list');
    const logPeriodSelect = document.getElementById('log-period-select');
    const logPageSizeSelect = document.getElementById('log-page-size-select');
    const logPrevButton = document.getElementById('log-prev-button');
    const logNextButton = document.getElementById('log-next-button');
    const logPageInfo = document.getElementById('log-page-info');
    let logCurrentPage = 1;
    let pageStartMarkers = [null];

    // --- 検索・ソート・絞り込み機能 ---
    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');
    const filterControls = document.getElementById('filter-controls');
    const helpSearchInput = document.getElementById('help-search-input');
    let allMembers = [];
    let biometricsMap = {};

    // --- 管理者管理機能 ---
    const navLinkAdmins = document.getElementById('nav-link-admins');
    const adminManagementPanel = document.getElementById('admin-management-panel');
    const adminListDiv = document.getElementById('admin-list');
    const addAdminForm = document.getElementById('add-admin-form');
    const addAdminButton = document.getElementById('add-admin-button');

    // --- Discord連携 ---
    const navLinkDiscord = document.getElementById('nav-link-discord');
    const discordIntegrationPanel = document.getElementById('discord-integration-panel');
    const discordSettingsForm = document.getElementById('discord-settings-form');
    const manualSyncButton = document.getElementById('manual-sync-button');

    // --- その他設定 ---
    const updateApiKeyButton = document.getElementById('update-api-key-button');
    const copyApiUrlButton = document.getElementById('copy-api-url-button'); 
    const updateFaceVerifyApiKeyButton = document.getElementById('update-face-verify-api-key-button');
    const copyFaceVerifyApiUrlButton = document.getElementById('copy-face-verify-api-url-button');
    let isDiscordFormDirty = false;

    // 照合モード用のDOM要素を追加 ▼▼▼
    const enrollTabButton = document.getElementById('enroll-tab-button');
    const verifyTabButton = document.getElementById('verify-tab-button');
    const enrollModeDiv = document.getElementById('enroll-mode');
    const verifyModeDiv = document.getElementById('verify-mode');
    const faceEnrollTabButton = document.getElementById('face-enroll-tab-button');
    const faceEnrollModeDiv = document.getElementById('face-enroll-mode');
    const verifyVideo = document.getElementById('verify-video');
    const verifyStatus = document.getElementById('verify-status');
    const verifyResultCard = document.getElementById('verify-result-card');
    let verificationInterval = null; // 照合処理のインターバルID

    const errorOverlay = document.getElementById('error-overlay');
    const errorMessage = document.getElementById('error-message');
    const retryButton = document.getElementById('retry-button');

    let modelsLoaded = false;

    // face-api.jsのモデルを非同期で読み込む関数
    async function loadModels() {
        if (modelsLoaded) return;
        const MODEL_URL = '/weights'; // モデルファイルが置いてあるパス
        try {
            console.log("顔認識モデルの読み込みを開始します...");
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);
            modelsLoaded = true;
            console.log("顔認識モデルの読み込みが完了しました。");
        } catch (error) {
            console.error("モデルの読み込みに失敗しました:", error);
            alert('顔認識モデルの読み込みに失敗しました。ページを再読み込みしてください。');
        }
    }

    // --- 認証処理 ---
    onAuthStateChanged(auth, user => {
        if (user) {
            loginForm.parentElement.style.display = 'none';
            mainContent.style.display = 'block';
            hamburgerButton.style.display = 'flex';
            initializePage();
        } else {
            loginForm.parentElement.style.display = 'flex';
            mainContent.style.display = 'none';
            hamburgerButton.style.display = 'none';
            homeButton.style.display = 'none';
        }
    });

    function initializePage() {
        populateExportColumnSelection();
        loadAdminMemberList();
        setupLogEventListeners();
        loadActivityLogs();
        loadAdminList();
        loadSettings();
        initFaceEnrollmentTab();
    }

    retryButton.addEventListener('click', loadSettings);

    // --- 生体情報登録・照合ページのイベントリスナー ---
    // タブパネルの表示/非表示を切り替えるヘルパー関数
    function switchBiometricTab(activeTab, activePanel) {
        // まずカメラや照合処理を止める
        stopAllBiometricProcesses();

        // 全てのタブとパネルを非アクティブ化
        [enrollTabButton, faceEnrollTabButton, verifyTabButton].forEach(btn => btn.classList.remove('active'));
        [enrollModeDiv, faceEnrollModeDiv, verifyModeDiv].forEach(panel => panel.style.display = 'none');

        // 指定されたタブとパネルをアクティブ化
        activeTab.classList.add('active');
        activePanel.style.display = 'block';
    }

    enrollTabButton.addEventListener('click', () => {
        switchBiometricTab(enrollTabButton, enrollModeDiv);
    });

    faceEnrollTabButton.addEventListener('click', () => {
        switchBiometricTab(faceEnrollTabButton, faceEnrollModeDiv);
        // このタブに切り替えたときにカメラを起動するロジックはinitFaceEnrollmentTab内にあります
    });

    verifyTabButton.addEventListener('click', () => {
        switchBiometricTab(verifyTabButton, verifyModeDiv);
        startVerification();
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
        if (panelToShow !== biometricEnrollmentPanel && verificationInterval) {
            clearInterval(verificationInterval);
            verificationInterval = null;
            const stream = verifyVideo.srcObject;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                verifyVideo.srcObject = null;
            }
        }
        if (panelToShow === allFeaturesPanel) {
            homeButton.style.display = 'none';
        } else {
            homeButton.style.display = 'flex';
        }

        if (panelToShow === biometricEnrollmentPanel) {
            populateBiometricMemberSelect();
        }
        if (panelToShow === analyticsPanel && !analyticsDataLoaded) {
            loadAnalyticsData();
        }

        exportOptionsModal.style.display = 'none'; 

        if (isDiscordFormDirty && !confirm("未保存の変更があります。ページを移動しますか？")) return;
        isDiscordFormDirty = false;

        document.querySelectorAll('.content-panel').forEach(panel => panel.style.display = 'none');
        panelToShow.style.display = 'block';
        sideNav.classList.remove('open');
    }


    // --- 生体情報登録・照合ページのイベントリスナー ---

    // 顔登録タブの初期化処理（登録ボタンのイベントリスナーのみ設定）
    function initFaceEnrollmentTab() {
        const video = document.getElementById('video');
        const tokenInput = document.getElementById('enrollment-token');
        const statusText = document.getElementById('enrollment-status');
        const faceOverlay = document.getElementById('face-overlay');
        const startButton = document.getElementById('start-enrollment-button');
    
        // この関数はページ読み込み時に一度だけ呼ばれる
        startButton.addEventListener('click', async () => {
            const token = tokenInput.value;
            if (!token) {
                statusText.textContent = 'トークンを入力してください。';
                return;
            }
    
            statusText.textContent = '顔を検出しています...';
            faceOverlay.classList.remove('success', 'failure');
            startButton.disabled = true;
    
            try {
                // モデルが読み込まれていなければ待つ
                await loadModels();

                const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
                                              .withFaceLandmarks()
                                              .withFaceDescriptor();
    
                if (!detection) {
                    statusText.textContent = '顔が検出できませんでした。もう一度試してください。';
                    faceOverlay.classList.add('failure');
                    return;
                }
    
                statusText.textContent = '顔を検出しました。サーバーに登録しています...';
                faceOverlay.classList.add('success');
    
                const templateData = Array.from(detection.descriptor);
                const registerBiometric = httpsCallable(functions, 'registerBiometric');
                const result = await registerBiometric({ token, templateData });
                
                alert(result.data.result);
                statusText.textContent = "登録が完了しました。";
                
                // 登録完了後、トークン生成タブに戻る
                enrollTabButton.click();
    
            } catch (error) {
                console.error("登録エラー:", error);
                statusText.textContent = `エラー: ${error.message}`;
                faceOverlay.classList.add('failure');
            } finally {
                startButton.disabled = false;
            }
        });
    }

    // カメラ関連の処理をすべて停止するヘルパー関数
    function stopAllBiometricProcesses() {
        if (verificationInterval) {
            clearInterval(verificationInterval);
            verificationInterval = null;
        }
        // 各カメラ要素のストリームを停止
        const video = document.getElementById('video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
            video.srcObject = null;
        }
        const verifyVideoEl = document.getElementById('verify-video');
        if (verifyVideoEl && verifyVideoEl.srcObject) {
            verifyVideoEl.srcObject.getTracks().forEach(track => track.stop());
            verifyVideoEl.srcObject = null;
        }
        console.log("All camera streams stopped.");
    }

    // タブパネルの表示/非表示を切り替えるヘルパー関数
    // function switchBiometricTab(activeTab, activePanel) {
    //     [enrollTabButton, faceEnrollTabButton, verifyTabButton].forEach(btn => btn.classList.remove('active'));
    //     [enrollModeDiv, faceEnrollModeDiv, verifyModeDiv].forEach(panel => panel.style.display = 'none');

    //     activeTab.classList.add('active');
    //     activePanel.style.display = 'block';
    // }
    
    // 顔情報登録タブで使うカメラを起動する関数
    async function startCameraForEnrollment() {
        await loadModels(); // モデル読み込みを待つ
        const video = document.getElementById('video');
        const statusText = document.getElementById('enrollment-status');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
            if(video) video.srcObject = stream;
        } catch (err) {
            console.error("顔登録用のカメラ起動に失敗:", err);
            if(statusText) statusText.textContent = 'エラー: カメラ起動失敗';
        }
    }
    
    // 各タブボタンのクリックイベント
    enrollTabButton.addEventListener('click', () => {
        stopAllBiometricProcesses();
        switchBiometricTab(enrollTabButton, enrollModeDiv);
    });

    faceEnrollTabButton.addEventListener('click', () => {
        stopAllBiometricProcesses();
        switchBiometricTab(faceEnrollTabButton, faceEnrollModeDiv);
        startCameraForEnrollment();
    });

    verifyTabButton.addEventListener('click', () => {
        // startVerification内でカメラ停止処理も行うため、ここでは呼ばない
        switchBiometricTab(verifyTabButton, verifyModeDiv);
        startVerification();
    });

    // 照合処理
    async function startVerification() {
        // 処理開始時に一度すべてのカメラを止める
        stopAllBiometricProcesses();
        await loadModels();

        verifyStatus.textContent = 'カメラ準備中...';
        verifyResultCard.style.display = 'none';
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
            if (verifyVideo) verifyVideo.srcObject = stream;
        } catch (err) {
            verifyStatus.textContent = 'エラー: カメラの起動に失敗しました。';
            return;
        }

        verifyStatus.textContent = '照合中... カメラに顔を向けてください。';

        verificationInterval = setInterval(async () => {
            if (!verifyVideo || !verifyVideo.srcObject) {
                if(verificationInterval) clearInterval(verificationInterval);
                return;
            }
            
            const detection = await faceapi.detectSingleFace(verifyVideo, new faceapi.TinyFaceDetectorOptions())
                                          .withFaceLandmarks()
                                          .withFaceDescriptor();
            
            if (detection) {
                verifyStatus.textContent = '顔を検出、サーバーで照合中...';
                const templateData = Array.from(detection.descriptor);

                try {
                    const identifyMember = httpsCallable(functions, 'identifyMemberByFace');
                    const result = await identifyMember({ descriptor: templateData });
                    
                    if (result.data) {
                        const member = result.data;
                        verifyStatus.textContent = '一致する部員が見つかりました！';
                        verifyResultCard.innerHTML = `
                            <h3>${member.name}</h3>
                            <p><strong>学年:</strong> ${member.grade || '未設定'}</p>
                            <p><strong>フリガナ:</strong> ${member.furigana || '未設定'}</p>
                            <p><strong>ステータス:</strong> ${member.isExpired ? '失効' : (member.status === 'in' ? '在室中' : '不在')}</p>
                        `;
                        verifyResultCard.style.display = 'block';
                        stopAllBiometricProcesses(); // 成功したら停止
                    } else {
                        verifyStatus.textContent = '登録データに一致しません。照合中...';
                        verifyResultCard.style.display = 'none';
                    }
                } catch (error) {
                    console.error("照合エラー:", error);
                    verifyStatus.textContent = `エラー: ${error.message}`;
                }
            }
        }, 2000);
    }

    // ナビゲーションイベントリスナー
    navLinkAllFeatures.addEventListener('click', (e) => { e.preventDefault(); showPanel(allFeaturesPanel); });
    navLinkMembers.addEventListener('click', (e) => { e.preventDefault(); showPanel(memberManagementPanel); });
    navLinkAdmins.addEventListener('click', (e) => { e.preventDefault(); showPanel(adminManagementPanel); });
    navLinkLogs.addEventListener('click', (e) => { e.preventDefault(); showPanel(activityLogPanel); });
    navLinkAnalytics.addEventListener('click', (e) => { e.preventDefault(); showPanel(analyticsPanel); });
    navLinkDiscord.addEventListener('click', (e) => { e.preventDefault(); showPanel(discordIntegrationPanel); });
    navLinkHelp.addEventListener('click', (e) => { e.preventDefault(); showPanel(helpPanel); });

    allFeaturesPanel.addEventListener('click', (e) => {
        const card = e.target.closest('.feature-card');
        if (!card) return;
        const panelId = card.dataset.panel;
        const panelToShow = document.getElementById(panelId);
        if (panelToShow) {
            showPanel(panelToShow);
        }
    });

    homeButton.addEventListener('click', (e) => {
        e.preventDefault();
        showPanel(allFeaturesPanel);
    });


    async function loadSettings() {
        // 読み込み開始時にエラー表示を隠す
        errorOverlay.style.display = 'none';
        try {
            const getSettings = httpsCallable(functions, 'getSettings');
            const result = await getSettings();
            const settings = result.data || {};

            // 成功したらメインコンテンツを表示
            document.querySelector('#main-content .container').style.display = 'flex';
            
            // ... (既存の設定値の代入処理はそのまま) ...
            const apiKeyDisplay = document.getElementById('api-key-display');
            const faceVerifyApiKeyDisplay = document.getElementById('face-verify-api-key-display');
            
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
            if (faceVerifyApiKeyDisplay) faceVerifyApiKeyDisplay.value = settings.faceVerifyApiKey || 'APIキーが設定されていません';

        } catch (error) {
            console.error("設定の読み込みに失敗:", error);
            // 失敗したらメインコンテンツを隠し、エラー表示を出す
            document.querySelector('#main-content .container').style.display = 'none';
            errorMessage.textContent = '設定の読み込みに失敗しました。サーバーが起動中の可能性があります。';
            errorOverlay.style.display = 'block';
        }
    }

    // --- 分析ページ機能 ---
    async function loadAnalyticsData() {
        analyticsDataLoaded = true;
        const durationChartContainer = document.getElementById('stay-duration-chart').parentElement;
        const entryChartContainer = document.getElementById('entry-count-chart').parentElement;
        durationChartContainer.innerHTML = '<p>データを集計中です...</p><canvas id="stay-duration-chart"></canvas>';
        entryChartContainer.innerHTML = '<p>データを集計中です...</p><canvas id="entry-count-chart"></canvas>';

        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const q = query(
            collection(db, 'activity_logs'),
            where('timestamp', '>=', Timestamp.fromDate(oneMonthAgo)),
            orderBy('timestamp', 'asc')
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            durationChartContainer.innerHTML = '<h3>部室滞在時間</h3><p>直近1ヶ月のログデータがありません。</p>';
            entryChartContainer.innerHTML = '<h3>部室入室回数</h3><p>直近1ヶ月のログデータがありません。</p>';
            return;
        }

        const memberStayDurations = {};
        const memberEntryCounts = {};
        const memberLastInTime = {};

        snapshot.forEach(doc => {
            const log = doc.data();
            if (!log.memberName || !log.timestamp) return;

            if (log.action === 'in') {
                memberLastInTime[log.memberName] = log.timestamp.toDate();
                memberEntryCounts[log.memberName] = (memberEntryCounts[log.memberName] || 0) + 1;
            } else if (log.action === 'out' && memberLastInTime[log.memberName]) {
                const duration = log.timestamp.toDate() - memberLastInTime[log.memberName];
                memberStayDurations[log.memberName] = (memberStayDurations[log.memberName] || 0) + duration;
                delete memberLastInTime[log.memberName];
            }
        });

        const sortedDurations = Object.entries(memberStayDurations)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const sortedEntries = Object.entries(memberEntryCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        stayDurationChart = renderChart(
            'stay-duration-chart',
            stayDurationChart,
            '部室滞在時間',
            '滞在時間',
            '時間 (Hours)',
            sortedDurations.map(item => item[0]),
            sortedDurations.map(item => (item[1] / (1000 * 60 * 60)).toFixed(2))
        );
        entryCountChart = renderChart(
            'entry-count-chart',
            entryCountChart,
            '部室入室回数',
            '入室回数',
            '回数 (Count)',
            sortedEntries.map(item => item[0]),
            sortedEntries.map(item => item[1])
        );
    }

    function renderChart(canvasId, chartInstance, chartTitle, datasetLabel, xAxisLabel, labels, data) {
        const container = document.getElementById(canvasId).parentElement;
        container.querySelector('p')?.remove();
        if (chartInstance) chartInstance.destroy();

        const ctx = document.getElementById(canvasId).getContext('2d');
        return new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: datasetLabel,
                    data: data,
                    backgroundColor: 'rgba(76, 175, 80, 0.5)',
                    borderColor: 'rgba(76, 175, 80, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                scales: {
                    x: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: xAxisLabel
                        }
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: chartTitle,
                        font: { size: 16 }
                    },
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    // --- 部員登録フォームの有効期限 ---
    const newMemberExpirySelect = document.getElementById('new-member-expiry');
    const newMemberCustomExpiryInput = document.getElementById('new-member-custom-expiry');
    newMemberExpirySelect.addEventListener('change', () => {
        newMemberCustomExpiryInput.style.display = newMemberExpirySelect.value === 'custom' ? 'block' : 'none';
    });

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

    // --- APIキー管理ページ ---
    updateApiKeyButton.addEventListener('click', async () => {
        if (!confirm('新しいAPIキーを生成しますか？古いキーは上書きされ、使用できなくなります。')) return;
        const generateRandomString = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
        const newApiKey = generateRandomString();
        try {
            const updateApiKey = httpsCallable(functions, 'updateApiKey');
            await updateApiKey({ apiKey: newApiKey });
            document.getElementById('api-key-display').value = newApiKey;
            alert('新しいAPIキーを生成・保存しました。');
        } catch (error) {
            alert(`更新に失敗しました: ${error.message}`);
        }
    });

    updateFaceVerifyApiKeyButton.addEventListener('click', async () => {
        if (!confirm('新しい「顔認証APIキー」を生成しますか？古いキーは使用できなくなります。')) return;
        const generateRandomString = () => Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
        const newApiKey = generateRandomString();
        try {
            const updateApiKey = httpsCallable(functions, 'updateApiKey');
            // keyType に 'faceVerifyApiKey' を指定
            await updateApiKey({ apiKey: newApiKey, keyType: 'faceVerifyApiKey' });
            document.getElementById('face-verify-api-key-display').value = newApiKey;
            alert('新しいAPIキーを生成・保存しました。');
        } catch (error) {
            alert(`更新に失敗しました: ${error.message}`);
        }
    });


    copyApiUrlButton.addEventListener('click', () => {
        const urlToCopy = document.getElementById('api-endpoint-url');
        navigator.clipboard.writeText(urlToCopy.value).then(() => {
            const originalText = copyApiUrlButton.textContent;
            copyApiUrlButton.textContent = 'コピーしました!';
            setTimeout(() => {
                copyApiUrlButton.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('コピーに失敗しました', err);
            alert('クリップボードへのコピーに失敗しました。');
        });
    });

    copyFaceVerifyApiUrlButton.addEventListener('click', () => {
        const urlToCopy = document.getElementById('face-verify-api-endpoint-url');
        navigator.clipboard.writeText(urlToCopy.value).then(() => {
            const originalText = copyFaceVerifyApiUrlButton.textContent;
            copyFaceVerifyApiUrlButton.textContent = 'コピーしました!';
            setTimeout(() => {
                copyFaceVerifyApiUrlButton.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('コピーに失敗しました', err);
            alert('クリップボードへのコピーに失敗しました。');
        });
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
        onSnapshot(query(collection(db, 'biometrics')), (bioSnapshot) => {
            biometricsMap = {};
            bioSnapshot.forEach(doc => {
                const data = doc.data();
                if (!biometricsMap[data.memberId]) biometricsMap[data.memberId] = [];
                biometricsMap[data.memberId].push(data.type);
            });

            onSnapshot(query(membersCollection), (memberSnapshot) => {
                const now = new Date();
                allMembers = [];
                const updates = [];
                memberSnapshot.forEach(docSnap => {
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
                populateProjectFilter();
                renderMemberList();
            });
        });
    }

    function populateProjectFilter() {
        const projectFilter = document.getElementById('filter-project');
        const existingProjects = new Set(Array.from(projectFilter.options).map(opt => opt.value));
        const currentProjects = new Set(allMembers.map(m => m.project).filter(Boolean));

        currentProjects.forEach(project => {
            if (!existingProjects.has(project)) {
                const option = document.createElement('option');
                option.value = project;
                option.textContent = project;
                projectFilter.appendChild(option);
            }
        });
    }

    function populateBiometricMemberSelect() {
        biometricMemberSelect.innerHTML = '<option value="">登録する部員を選択してください</option>';
        const activeMembers = allMembers.filter(m => !m.isExpired);
        activeMembers.sort((a,b) => (a.furigana || a.name).localeCompare(b.furigana || b.name, 'ja'));

        activeMembers.forEach(member => {
            const memberBiometrics = biometricsMap[member.id] || [];
            const fingerprintStatus = memberBiometrics.includes('fingerprint') ? ' (指紋登録済)' : '';
            const faceStatus = memberBiometrics.includes('face') ? ' (顔登録済)' : '';
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = `${member.name}${fingerprintStatus}${faceStatus}`;
            biometricMemberSelect.appendChild(option);
        });
    }

    function renderMemberList() {
        let displayedMembers = [...allMembers];

        const filters = {
            expired: document.getElementById('filter-expired').value,
            status: document.getElementById('filter-status').value,
            grade: document.getElementById('filter-grade').value,
            category: document.getElementById('filter-category').value,
            project: document.getElementById('filter-project').value,
            gender: document.getElementById('filter-gender').value,
            age: document.getElementById('filter-age').value
        };

        displayedMembers = displayedMembers.filter(member => {
            if (filters.expired && String(member.isExpired) !== filters.expired) return false;
            if (filters.status && member.status !== filters.status) return false;
            if (filters.grade && member.grade !== filters.grade) return false;
            if (filters.category && member.category !== filters.category) return false;
            if (filters.project && member.project !== filters.project) return false;
            if (filters.gender && member.gender !== filters.gender) return false;
            if (filters.age) {
                const age = member.age;
                if (!age) return false;
                if (filters.age === '26+') {
                    if (age < 26) return false;
                } else {
                    if (age !== parseInt(filters.age, 10)) return false;
                }
            }
            return true;
        });

        const searchTerm = searchInput.value.toLowerCase();
        if (searchTerm) {
            displayedMembers = displayedMembers.filter(member => {
                const name = member.name.toLowerCase();
                const furigana = (member.furigana || '').toLowerCase();
                return name.includes(searchTerm) || furigana.includes(searchTerm);
            });
        }
        
        const sortOption = sortSelect.value;
        displayedMembers.sort((a, b) => {
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
        if (displayedMembers.length === 0) {
            adminMemberListDiv.innerHTML += '<p style="text-align: center; padding: 20px;">該当する部員はいません。</p>';
            updateSelection();
            return;
        }
        const checkedIds = new Set(Array.from(document.querySelectorAll('.member-checkbox:checked')).map(cb => cb.dataset.id));
        displayedMembers.forEach(member => {
            const statusText = member.isExpired ? '失効' : (member.status === 'in' ? '在室中' : '不在');
            const statusClass = member.isExpired ? 'status-expired' : (member.status === 'in' ? 'status-in-text' : '');
            const memberClass = member.isExpired ? 'member expired' : 'member';
            const expiryDateStr = member.expiryDate ? member.expiryDate.toDate().toLocaleDateString('ja-JP') : '期限なし';
            const isChecked = checkedIds.has(member.id) ? 'checked' : '';
            const keyInfo = member.isExpired ? '' : `キー[${member.assignedKey}] / `;
            
            const memberBiometrics = biometricsMap[member.id] || [];
            const hasFingerprint = memberBiometrics.includes('fingerprint');
            const hasFace = memberBiometrics.includes('face');

            const biometricHTML = `
                <div class="biometric-info">
                    <div class="biometric-status">
                        <span class="status-label">指紋</span>
                        <span class="status-text ${hasFingerprint ? 'status-registered' : 'status-not-registered'}">${hasFingerprint ? '登録済み' : '未登録'}</span>
                        ${hasFingerprint ? `<button class="delete-button delete-biometric-button" data-member-id="${member.id}" data-type="fingerprint">削除</button>` : ''}
                    </div>
                    <div class="biometric-status">
                        <span class="status-label">顔</span>
                        <span class="status-text ${hasFace ? 'status-registered' : 'status-not-registered'}">${hasFace ? '登録済み' : '未登録'}</span>
                        ${hasFace ? `<button class="delete-button delete-biometric-button" data-member-id="${member.id}" data-type="face">削除</button>` : ''}
                    </div>
                </div>
            `;

            const html = `
                <div class="${memberClass}" id="member-item-${member.id}">
                    <div class="member-summary">
                         <input type="checkbox" class="member-checkbox" data-id="${member.id}" ${isChecked}>
                        <div class="summary-info">
                            <strong>${member.name}</strong> <small>(${member.furigana || 'フリガナ未設定'})</small>
                        </div>
                        <div class="summary-status">
                            <span class="expiry-date">期限: ${expiryDateStr}</span>
                            <span class="status-text ${statusClass}">${statusText}</span>
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
                        <p><strong>その他:</strong> ${keyInfo}${member.gender || ''} / ${member.grade || ''} / ${member.category || ''} / ${member.age || '?'}歳</p>
                        ${biometricHTML}
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
                            <select id="edit-expiry-${member.id}">
                                <option value="">有効期限を変更しない</option>
                                <option value="this-october">今年の10月末</option>
                                <option value="next-april">来年の4月末</option>
                                <option value="custom">年月日を指定</option>
                                <option value="expire-now">失効させる</option>
                            </select>
                            <input type="date" id="edit-custom-expiry-${member.id}" style="display: none;">
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
    
    // イベントリスナー
    searchInput.addEventListener('input', renderMemberList);
    sortSelect.addEventListener('change', renderMemberList);
    filterControls.addEventListener('change', renderMemberList);
    helpSearchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const topics = document.querySelectorAll('#help-panel .help-topic');
        topics.forEach(topic => {
            const topicText = topic.textContent.toLowerCase();
            if (topicText.includes(searchTerm)) {
                topic.style.display = 'block';
            } else {
                topic.style.display = 'none';
            }
        });
    });

    const handleBiometricRegistration = async (biometricType) => {
        const memberId = biometricMemberSelect.value;
        if (!memberId) {
            alert('部員を選択してください。');
            return;
        }

        const typeText = biometricType === 'fingerprint' ? '指紋' : '顔';
        const button = biometricType === 'fingerprint' ? registerFingerprintButton : registerFaceButton;

        try {
            button.textContent = 'トークン生成中...';
            button.disabled = true;
            const generateToken = httpsCallable(functions, 'generateEnrollmentToken');
            const result = await generateToken({ memberId, biometricType });
            
            tokenDisplayText.textContent = result.data.token;
            tokenDisplayModal.style.display = 'flex';
        } catch (error) {
            console.error("トークン生成エラー:", error);
            alert(`エラー: ${error.message}`);
        } finally {
            button.textContent = `${typeText}を登録`;
            button.disabled = false;
        }
    };
    registerFingerprintButton.addEventListener('click', () => handleBiometricRegistration('fingerprint'));
    registerFaceButton.addEventListener('click', () => handleBiometricRegistration('face'));
    closeTokenModalButton.addEventListener('click', () => {
        tokenDisplayModal.style.display = 'none';
    });

    addMemberForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameInput = document.getElementById('new-member-name');
        const studentIdInput = document.getElementById('new-member-studentid');
        const nameCheckQuery = query(membersCollection, where('name', '==', nameInput.value));
        const nameCheck = await getDocs(nameCheckQuery);
        if (!nameCheck.empty) {
            alert('エラー: 同じ名前の部員が既に登録されています。');
            return;
        }
        const studentIdCheckQuery = query(membersCollection, where('studentId', '==', studentIdInput.value));
        const studentIdCheck = await getDocs(studentIdCheckQuery);
        if (!studentIdCheck.empty) {
            alert('エラー: 同じ学籍番号の部員が既に登録されています。');
            return;
        }
        const assignedKey = await findNextAvailableKey();
        if (!assignedKey) {
            alert('エラー: 割り当て可能なキーがありません。');
            return;
        }

        const expiryChoice = document.getElementById('new-member-expiry').value;
        const customExpiryInput = document.getElementById('new-member-custom-expiry');
        let expiryDate;

        if (expiryChoice === 'custom') {
            if (!customExpiryInput.value) {
                alert('有効期限の年月日を指定してください。');
                return;
            }
            expiryDate = new Date(customExpiryInput.value);
        } else {
            expiryDate = getPresetExpiryDate(expiryChoice);
        }

        if (!expiryDate) {
            alert('有効期限を選択してください。');
            return;
        }

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
        customExpiryInput.style.display = 'none';
        alert(`${nameInput.value} さんを追加しました (キー: ${assignedKey})`);
    });

    document.addEventListener('click', async (e) => {
        const target = e.target;

        // ▼▼▼ このブロックを新しく追加 ▼▼▼
        // 生体情報削除ボタンの処理
        if (target.classList.contains('delete-biometric-button')) {
            const memberId = target.dataset.memberId;
            const biometricType = target.dataset.type;
            const typeText = biometricType === 'fingerprint' ? '指紋' : '顔';
            
            if (confirm(`本当にこの部員の${typeText}情報を削除しますか？`)) {
                try {
                    target.textContent = '削除中...';
                    target.disabled = true;
                    const deleteBiometric = httpsCallable(functions, 'deleteBiometric');
                    await deleteBiometric({ memberId, biometricType });
                    alert(`${typeText}情報を削除しました。`);
                    // onSnapshotが自動でUIを更新するため、ここでは画面リロードは不要
                } catch (error) {
                    console.error("生体情報の削除エラー:", error);
                    alert(`エラー: ${error.message}`);
                    target.textContent = '削除';
                    target.disabled = false;
                }
            }
            return; // 他のクリックイベントと重複しないようにここで処理を終了
        }
        
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
                } else if (expiryChoice === 'custom') {
                    const customDateVal = document.getElementById(`edit-custom-expiry-${id}`).value;
                    if (!customDateVal) {
                        alert('有効期限の年月日を指定してください。');
                        return;
                    }
                    updatedData.expiryDate = Timestamp.fromDate(new Date(customDateVal));
                    updatedData.isExpired = false;
                } else {
                    const newExpiryDate = getPresetExpiryDate(expiryChoice);
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

        if (target.classList.contains('delete-button') && target.dataset.id) { // 通常の部員削除
            if (confirm('本当にこの部員を削除しますか？')) {
                await deleteDoc(doc(db, 'members', target.dataset.id));
                alert('部員を削除しました。');
            }
            return;
        }
        memberItem.classList.toggle('is-open');
    });

    adminMemberListDiv.addEventListener('change', (e) => {
        if (e.target.matches('select[id^="edit-expiry-"]')) {
            const editView = e.target.closest('.edit-view');
            const customInput = editView.querySelector('input[type="date"]');
            if (customInput) {
                customInput.style.display = e.target.value === 'custom' ? 'block' : 'none';
            }
        }
    });

    function getPresetExpiryDate(choice) {
        const now = new Date();
        let year = now.getFullYear();
        if (choice === 'this-october') return new Date(year, 9, 31, 23, 59, 59);
        if (choice === 'next-april') return new Date(year + 1, 3, 30, 23, 59, 59);
        return null;
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
        bulkExpiryControls.style.display = bulkActionSelect.value === 'update-expiry' ? 'inline-flex' : 'none';
    });
    bulkExpirySelect.addEventListener('change', () => {
        bulkCustomExpiryInput.style.display = bulkExpirySelect.value === 'custom' ? 'inline-block' : 'none';
    });

    bulkApplyButton.addEventListener('click', async () => {
        const selectedIds = Array.from(document.querySelectorAll('.member-checkbox:checked')).map(cb => cb.dataset.id);
        const action = bulkActionSelect.value;
        if (selectedIds.length === 0) {
            alert('操作対象の部員が選択されていません。');
            return;
        }
        if (!action) {
            alert('一括操作を選択してください。');
            return;
        }
        const batch = writeBatch(db);

        if (action === 'delete') {
            if (!confirm(`選択した ${selectedIds.length} 件の部員を本当に削除しますか？`)) return;
            selectedIds.forEach(id => batch.delete(doc(db, 'members', id)));
            await batch.commit();
            alert(`${selectedIds.length} 件の部員を削除しました。`);

        } else if (action === 'update-expiry') {
            const choice = bulkExpirySelect.value;
            if (!choice) {
                alert('更新後の有効期限を選択してください。');
                return;
            }
            if (!confirm(`選択した ${selectedIds.length} 件の部員の有効期限を更新しますか？`)) return;

            if (choice === 'expire-now') {
                selectedIds.forEach(id => {
                    batch.update(doc(db, 'members', id), { isExpired: true, expiryDate: null });
                });
            } else if (choice === 'custom') {
                const customDate = bulkCustomExpiryInput.value;
                if (!customDate) {
                    alert('有効期限の年月日を指定してください。');
                    return;
                }
                const newExpiryDate = new Date(customDate);
                selectedIds.forEach(id => {
                    batch.update(doc(db, 'members', id), {
                        expiryDate: Timestamp.fromDate(newExpiryDate),
                        isExpired: false
                    });
                });
            } else {
                const newExpiryDate = getPresetExpiryDate(choice);
                if (newExpiryDate) {
                    selectedIds.forEach(id => {
                        batch.update(doc(db, 'members', id), {
                            expiryDate: Timestamp.fromDate(newExpiryDate),
                            isExpired: false
                        });
                    });
                }
            }
            await batch.commit();
            alert(`${selectedIds.length} 件の部員の有効期限を更新しました。`);
        }

        const selectAllCheckbox = document.getElementById('select-all-checkbox');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        renderMemberList();
    });

    const templateHeaders = {
        '名前(必須)': 'name',
        'フリガナ(必須)': 'furigana',
        '学籍番号(必須)': 'studentId',
        'メールアドレス(必須)': 'email',
        'DiscordユーザーID(必須)': 'discordId',
        '性別': 'gender',
        '年齢': 'age',
        '学年': 'grade',
        '類': 'category',
        '所属プロジェクト': 'project'
    };

    downloadTemplateButton.addEventListener('click', () => {
        const exampleRow = {};
        for (const key in templateHeaders) {
            exampleRow[key] = '';
        }
        exampleRow['名前(必須)'] = '電通 太郎';
        exampleRow['フリガナ(必須)'] = 'デンツウ タロウ';

        const worksheet = XLSX.utils.json_to_sheet([exampleRow], { header: Object.keys(templateHeaders) });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '部員テンプレート');
        XLSX.writeFile(workbook, '部員情報テンプレート.xlsx');
    });

    // --- Excelエクスポート 新機能 ---
    const exportableColumns = {
        '名前': 'name',
        'フリガナ': 'furigana',
        '学籍番号': 'studentId',
        'メールアドレス': 'email',
        'DiscordユーザーID': 'discordId',
        '性別': 'gender',
        '年齢': 'age',
        '学年': 'grade',
        '類': 'category',
        '所属プロジェクト': 'project',
        '割り当てキー': 'assignedKey',
        'ステータス': 'status',
        '有効期限': 'expiryDate',
        '失効': 'isExpired'
    };

    function populateExportColumnSelection() {
        exportColumnSelectionDiv.innerHTML = '';
        for (const displayName in exportableColumns) {
            const key = exportableColumns[displayName];
            const label = document.createElement('label');
            label.innerHTML = `<input type="checkbox" name="export-column" value="${key}" checked> ${displayName}`;
            exportColumnSelectionDiv.appendChild(label);
        }
    }

    exportExcelButton.addEventListener('click', () => {
        if (allMembers.length === 0) {
            alert('エクスポートするデータがありません。');
            return;
        }
        exportOptionsModal.style.display = 'flex';
    });
    
    cancelExportButton.addEventListener('click', () => {
        exportOptionsModal.style.display = 'none';
    });

    executeExportButton.addEventListener('click', () => {
        const excludeExpired = exportExcludeExpiredCheckbox.checked;
        const membersToExport = excludeExpired ? allMembers.filter(m => !m.isExpired) : allMembers;

        const selectedKeys = Array.from(document.querySelectorAll('#export-column-selection input:checked')).map(cb => cb.value);
        if (selectedKeys.length === 0) {
            alert('出力する項目を1つ以上選択してください。');
            return;
        }

        const headers = selectedKeys.map(key => Object.keys(exportableColumns).find(k => exportableColumns[k] === key));
        
        const dataForExport = membersToExport.map(member => {
            const row = {};
            selectedKeys.forEach(key => {
                const displayName = headers[selectedKeys.indexOf(key)];
                let value = member[key] || '';
                if (key === 'status') {
                    value = member.isExpired ? '失効' : (member.status === 'in' ? '在室' : '不在');
                } else if (key === 'expiryDate' && value) {
                    value = value.toDate().toLocaleDateString('ja-JP');
                }
                row[displayName] = value;
            });
            return row;
        });

        const worksheet = XLSX.utils.json_to_sheet(dataForExport, { header: headers });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '部員情報');
        XLSX.writeFile(workbook, '部員情報.xlsx');
        
        exportOptionsModal.style.display = 'none';
    });


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

                for (const memberData of membersToImport) {
                    const member = {};
                    for (const header in templateHeaders) {
                        if (memberData[header] !== undefined) {
                            member[templateHeaders[header]] = memberData[header];
                        }
                    }
                    
                    const { name, furigana, studentId, email, discordId } = member;

                    if (!name || !furigana || !studentId || !email || !discordId) {
                        missingFieldsCount++;
                        continue;
                    }
                    if (existingNames.has(name) || existingStudentIds.has(String(studentId))) {
                        duplicateCount++;
                        continue;
                    }

                    const assignedKey = await findNextAvailableKey(newKeys);
                    if (!assignedKey) { alert('空きキーがなくなったため、処理を中断しました。'); break; }
                    newKeys.add(assignedKey);

                    const newMemberRef = doc(membersCollection);
                    batch.set(newMemberRef, {
                        ...member,
                        studentId: String(studentId),
                        discordId: String(discordId),
                        age: parseInt(member.age, 10) || null,
                        assignedKey: assignedKey,
                        status: 'out',
                        isExpired: true, 
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
                    `スキップ(必須項目不足): ${missingFieldsCount}件\n` +
                    `インポートされた部員は「失効」状態で登録されています。部員管理ページから有効期限を更新してください。`
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

        const now = new Date();
        let startDate;
        if (period === '1m') startDate = new Date(new Date().setMonth(now.getMonth() - 1));
        else if (period === '3m') startDate = new Date(new Date().setMonth(now.getMonth() - 3));
        else if (period === '1y') startDate = new Date(new Date().setFullYear(now.getFullYear() - 1));
        if (startDate) {
            q = query(q, where('timestamp', '>=', Timestamp.fromDate(startDate)));
        }

        const startAfterDoc = pageStartMarkers[logCurrentPage - 1];
        if (startAfterDoc) {
            q = query(q, startAfter(startAfterDoc));
        }
        q = query(q, limit(docsPerPage + 1));

        try {
            const snapshot = await getDocs(q);
            const docs = snapshot.docs;
            let hasNextPage = docs.length > docsPerPage;
            if (hasNextPage) docs.pop();

            if (docs.length > 0) {
                pageStartMarkers[logCurrentPage] = docs[docs.length - 1];
            }

            logPrevButton.disabled = logCurrentPage <= 1;
            logNextButton.disabled = !hasNextPage;
            logPageInfo.textContent = `ページ ${logCurrentPage}`;

            if (docs.length === 0 && logCurrentPage === 1) {
                activityLogListDiv.innerHTML = '<p>該当するログはありません。</p>';
                return;
            }

            activityLogListDiv.innerHTML = '';
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
    
    function initFaceEnrollmentTab() {
        const video = document.getElementById('video');
        const tokenInput = document.getElementById('enrollment-token');
        const statusText = document.getElementById('enrollment-status');
        const faceOverlay = document.getElementById('face-overlay');
        const startButton = document.getElementById('start-enrollment-button');
    
        async function startCameraForEnrollment() {
            await loadModels(); // 既にadmin.jsにあるモデル読み込み関数を利用
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
                video.srcObject = stream;
            } catch (err) {
                console.error("カメラの起動に失敗:", err);
                statusText.textContent = 'エラー: カメラ起動失敗';
            }
        }
    
        // このタブが表示されたときにカメラを起動するイベントリスナー
        faceEnrollTabButton.addEventListener('click', startCameraForEnrollment);

        startButton.addEventListener('click', async () => {
            const token = tokenInput.value;
            if (!token) {
                statusText.textContent = 'トークンを入力してください。';
                return;
            }
    
            statusText.textContent = '顔を検出しています...';
            faceOverlay.classList.remove('success', 'failure');
            startButton.disabled = true;
    
            try {
                const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
                                              .withFaceLandmarks()
                                              .withFaceDescriptor();
    
                if (!detection) {
                    statusText.textContent = '顔が検出できませんでした。もう一度試してください。';
                    faceOverlay.classList.add('failure');
                    return;
                }
    
                statusText.textContent = '顔を検出しました。サーバーに登録しています...';
                faceOverlay.classList.add('success');
    
                const templateData = Array.from(detection.descriptor);
                const registerBiometric = httpsCallable(functions, 'registerBiometric');
                const result = await registerBiometric({ token, templateData });
                
                alert(result.data.result); // アラートで成功を通知
                statusText.textContent = "登録が完了しました。";
                // 登録完了後、トークン生成タブに戻る
                enrollTabButton.click();
    
            } catch (error) {
                console.error("登録エラー:", error);
                statusText.textContent = `エラー: ${error.message}`;
                faceOverlay.classList.add('failure');
            } finally {
                startButton.disabled = false;
            }
        });
    }
}