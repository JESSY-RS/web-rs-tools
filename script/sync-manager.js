// =========================================================
// sync-manager.js (ハイブリッド同期マネージャー・シームレスバトンパス版)
// =========================================================

const GOOGLE_CLIENT_ID = "70056978870-uaepqe8ii826admdd8gqc8fbjb9bqnm3.apps.googleusercontent.com";
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCEaZLuD45Zu6OKco8EHtNjfBBmTW2SPik",
    authDomain: "renmabase.firebaseapp.com",
    projectId: "renmabase",
    storageBucket: "renmabase.firebasestorage.app",
    messagingSenderId: "154320130326",
    appId: "1:154320130326:web:cb448ec515f709fcbf4037"
};

const urlParams = new URLSearchParams(window.location.search);
const paramMode = urlParams.get('mode');

if (paramMode === 'secret_cloud_on') {
    localStorage.setItem('RenmaArmorCloudMode', 'true');
    localStorage.setItem('index_mode', 'admin');
} else if (paramMode === 'secret_admin_on') {
    localStorage.removeItem('RenmaArmorCloudMode');
    localStorage.setItem('index_mode', 'admin');
} else if (paramMode === 'secret_debug_on') {
    localStorage.removeItem('RenmaArmorCloudMode');
    localStorage.setItem('index_mode', 'debug');
}

const isCloudMode = (localStorage.getItem('RenmaArmorCloudMode') === 'true');

window.syncManager = {
    isCloudMode: isCloudMode,
    isLoggedIn: false,
    syncStatus: 'init', 
    config: null,
    accessToken: null,
    driveFileId: null,
    currentUser: null,
    db: null,
    setDoc: null,
    doc: null,
    getDoc: null,
    autoSaveTimer: null,
    onAuthChangeCallback: null,
    
    updateLoginTriggerUI: function(isLoggedIn) {
        if (this.config && this.config.loginTriggerId) {
            const triggerEl = document.getElementById(this.config.loginTriggerId);
            if (triggerEl) {
                if (isLoggedIn) {
                    triggerEl.style.cursor = 'default';
                    triggerEl.removeAttribute('title');
                } else {
                    triggerEl.style.cursor = 'pointer';
                    triggerEl.setAttribute('title', 'クリックでログイン');
                }
            }
        }
    },

    setStatusText: function(text, autoClear = false) {
        const statusEls = document.querySelectorAll('.cloud-status');
        if (statusEls.length === 0) return;
        
        statusEls.forEach(el => {
            if (text) {
                el.textContent = text;
                if (text === 'エラー') el.style.color = '#ff4500'; 
                else el.style.color = ''; 
            } else {
                el.textContent = '';
                el.style.color = '';
            }
        });

        if (autoClear) {
            setTimeout(() => {
                if (this.syncStatus === 'ready') {
                    statusEls.forEach(el => {
                        if (el.textContent === text) {
                            el.textContent = '';
                            el.style.color = '';
                        }
                    });
                }
            }, 2500);
        }
    }
};

if (!isCloudMode) {
    const savedToken = localStorage.getItem('GoogleDriveAccessToken');
    const expiry = localStorage.getItem('GoogleDriveTokenExpiry');
    if (savedToken && expiry && new Date().getTime() < parseInt(expiry)) {
        window.syncManager.accessToken = savedToken;
        window.syncManager.isLoggedIn = true;
    } else {
        localStorage.removeItem('GoogleDriveAccessToken');
        localStorage.removeItem('GoogleDriveTokenExpiry');
    }
}

if (isCloudMode) {
    import("https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js").then(module => {
        const app = module.initializeApp(FIREBASE_CONFIG);
        import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js").then(fs => {
            window.syncManager.db = fs.getFirestore(app);
            window.syncManager.setDoc = fs.setDoc;
            window.syncManager.doc = fs.doc;
            window.syncManager.getDoc = fs.getDoc;
        });
        import("https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js").then(authMod => {
            const auth = authMod.getAuth(app);
            const provider = new authMod.GoogleAuthProvider();
            
            window.triggerSyncLogin = () => authMod.signInWithPopup(auth, provider).catch(e => alert(e.message));
            window.triggerSyncLogout = () => authMod.signOut(auth).then(() => location.reload());

            authMod.onAuthStateChanged(auth, (user) => {
                window.syncManager.currentUser = user;
                window.syncManager.isLoggedIn = !!user;
                if (window.syncManager.onAuthChangeCallback) window.syncManager.onAuthChangeCallback(!!user);
                window.syncManager.updateLoginTriggerUI(!!user);
                
                if (user && window.syncManager.config) loadDataFromCloud();
                else window.syncManager.syncStatus = 'ready'; 
            });
        });
    });
} else {
    let tokenClient;
    function initGSI() {
        if (typeof google === 'undefined' || !google.accounts) {
            setTimeout(initGSI, 100);
            return;
        }
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: "https://www.googleapis.com/auth/drive.appdata",
            callback: (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) {
                    window.syncManager.accessToken = tokenResponse.access_token;
                    const expiry = new Date().getTime() + (tokenResponse.expires_in * 1000);
                    localStorage.setItem('GoogleDriveAccessToken', window.syncManager.accessToken);
                    localStorage.setItem('GoogleDriveTokenExpiry', expiry.toString());
                    window.syncManager.isLoggedIn = true;
                    
                    if (window.syncManager.onAuthChangeCallback) window.syncManager.onAuthChangeCallback(true);
                    window.syncManager.updateLoginTriggerUI(true);
                    
                    if (window.syncManager.config) loadDataFromDrive();
                }
            }
        });

        if (window.syncManager.isLoggedIn) {
            if (window.syncManager.onAuthChangeCallback) window.syncManager.onAuthChangeCallback(true);
        } else {
            window.syncManager.syncStatus = 'ready'; 
        }
    }
    initGSI();

    window.triggerSyncLogin = () => { if (tokenClient) tokenClient.requestAccessToken(); };
    window.triggerSyncLogout = () => {
        localStorage.removeItem('GoogleDriveAccessToken');
        localStorage.removeItem('GoogleDriveTokenExpiry');
        location.reload();
    };
}

window.setupSyncSystem = function(config) {
    window.syncManager.config = config;
    if (config.loginTriggerId) {
        const triggerEl = document.getElementById(config.loginTriggerId);
        if (triggerEl) {
            triggerEl.onclick = () => {
                if (!window.syncManager.isLoggedIn) window.triggerSyncLogin();
            };
        }
    }
    
    window.syncManager.updateLoginTriggerUI(window.syncManager.isLoggedIn);
    
    if (window.syncManager.isLoggedIn) {
        if (isCloudMode) loadDataFromCloud();
        else loadDataFromDrive();
    }
};

async function loadDataFromCloud() {
    window.syncManager.syncStatus = 'loading'; 
    window.syncManager.setStatusText('読込中...');
    
    try {
        const { db, getDoc, doc, currentUser, config } = window.syncManager;

        // ▼▼ シームレスバトンパス：未送信データがあればクラウド読込をスキップして即反映！ ▼▼
        const pendingDataStr = localStorage.getItem('PendingCloudSave_' + config.fileName);
        if (pendingDataStr) {
            console.log("未完了のセーブバトンを引き継ぎました。直ちに画面に反映し、アップロードを再開します。");
            if (config.onLoad) config.onLoad(JSON.parse(pendingDataStr));
            window.syncManager.setStatusText('読込完了', true);
            window.syncManager.syncStatus = 'ready'; 
            window.triggerSyncSave(); // バトンを受け取って即座にアップロード再開
            return;
        }

        const docRef = doc(db, "users", currentUser.uid, "renma_data", config.firestoreDoc);
        const docSnap = await getDoc(docRef);

        let loadedData = null;
        if (docSnap.exists()) loadedData = docSnap.data().data;
        
        if (config.onLoad) config.onLoad(loadedData);
        window.syncManager.setStatusText('読込完了', true);
    } catch (e) { 
        console.error("Firebase読込エラー:", e); 
        window.syncManager.setStatusText('エラー', true);
    } finally {
        window.syncManager.syncStatus = 'ready'; 
    }
}

async function loadDataFromDrive() {
    window.syncManager.syncStatus = 'loading'; 
    window.syncManager.setStatusText('読込中...');

    try {
        const { accessToken, config } = window.syncManager;

        // ▼▼ シームレスバトンパス：未送信データがあればクラウド読込をスキップして即反映！ ▼▼
        const pendingDataStr = localStorage.getItem('PendingCloudSave_' + config.fileName);
        if (pendingDataStr) {
            console.log("未完了のセーブバトンを引き継ぎました。直ちに画面に反映し、アップロードを再開します。");
            if (config.onLoad) config.onLoad(JSON.parse(pendingDataStr));
            window.syncManager.setStatusText('読込完了', true);
            window.syncManager.syncStatus = 'ready'; 
            window.triggerSyncSave(); 
            return;
        }

        const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${config.fileName}'`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const searchData = await searchRes.json();

        let loadedData = null;
        if (searchData.files && searchData.files.length > 0) {
            window.syncManager.driveFileId = searchData.files[0].id;
            const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${window.syncManager.driveFileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            loadedData = await dlRes.json();
        }
        if (config.onLoad) config.onLoad(loadedData);
        window.syncManager.setStatusText('読込完了', true);
    } catch (e) { 
        console.error("Drive読込エラー:", e); 
        window.syncManager.setStatusText('エラー', true);
    } finally {
        window.syncManager.syncStatus = 'ready'; 
    }
}

window.triggerSyncSave = function() {
    if (!window.syncManager.isLoggedIn || !window.syncManager.config) return;
    if (window.syncManager.syncStatus !== 'ready') return;
    
    // ▼▼ セーブが走った瞬間に、必ず最新状態を「バトン」としてローカルに残す ▼▼
    const dataToSave = window.syncManager.config.onSave();
    if (dataToSave) {
        localStorage.setItem('PendingCloudSave_' + window.syncManager.config.fileName, JSON.stringify(dataToSave));
    }

    if (window.syncManager.autoSaveTimer) clearTimeout(window.syncManager.autoSaveTimer);
    
    window.syncManager.autoSaveTimer = setTimeout(async () => {
        if (window.syncManager.syncStatus !== 'ready') return;
        
        window.syncManager.setStatusText('保存中...');

        if (isCloudMode) {
            try {
                const { db, setDoc, doc, currentUser, config } = window.syncManager;
                await setDoc(doc(db, "users", currentUser.uid, "renma_data", config.firestoreDoc), {
                    updatedAt: new Date(),
                    data: dataToSave
                });
                window.syncManager.setStatusText('保存完了', true);
                // 保存が完了したらバトンを破棄する
                localStorage.removeItem('PendingCloudSave_' + config.fileName);
            } catch (e) { 
                console.error("Firebase保存エラー", e);
                window.syncManager.setStatusText('エラー', true);
            }
        } else {
            try {
                const { accessToken, config } = window.syncManager;
                const jsonContent = JSON.stringify(dataToSave);

                if (!window.syncManager.driveFileId) {
                    const createRes = await fetch(`https://www.googleapis.com/drive/v3/files`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: config.fileName, parents: ['appDataFolder'] })
                    });
                    const createData = await createRes.json();
                    window.syncManager.driveFileId = createData.id;
                }

                await fetch(`https://www.googleapis.com/upload/drive/v3/files/${window.syncManager.driveFileId}?uploadType=media`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: jsonContent
                });
                window.syncManager.setStatusText('保存完了', true);
                // 保存が完了したらバトンを破棄する
                localStorage.removeItem('PendingCloudSave_' + config.fileName);
            } catch (e) { 
                console.error("Drive保存エラー", e); 
                window.syncManager.setStatusText('エラー', true);
            }
        }
    }, 2000);
};