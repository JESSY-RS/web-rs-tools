// =========================================================
// sync-manager.js (プライベート完全自動ログイン・本番用)
// =========================================================

const PRIVATE_EMAIL = "jessy-private@example.com";
const PRIVATE_PASSWORD = "mySecretPass3024";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCEaZLuD45Zu6OKco8EHtNjfBBmTW2SPik",
    authDomain: "renmabase.firebaseapp.com",
    projectId: "renmabase",
    storageBucket: "renmabase.firebasestorage.app",
    messagingSenderId: "154320130326",
    appId: "1:154320130326:web:cb448ec515f709fcbf4037"
};

const TARGET_UID = "y6AVRM3qK6YUsNExPeo8dX2p9g62";

const urlParams = new URLSearchParams(window.location.search);
const paramMode = urlParams.get('mode');

if (paramMode === 'secret_cloud_on' || paramMode === 'secret_admin_on') {
    localStorage.setItem('RenmaArmorCloudMode', 'true');
    localStorage.setItem('index_mode', 'admin');
} else if (paramMode === 'secret_debug_on') {
    localStorage.setItem('RenmaArmorCloudMode', 'true');
    localStorage.setItem('index_mode', 'debug');
}

const isCloudMode = true;
localStorage.setItem('RenmaArmorCloudMode', 'true');

window.syncManager = {
    isCloudMode: isCloudMode,
    isLoggedIn: false,
    syncStatus: 'init',
    config: null,
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
                triggerEl.style.cursor = 'default';
                triggerEl.removeAttribute('title');
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

import("https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js").then(module => {
    const app = module.initializeApp(FIREBASE_CONFIG);

    Promise.all([
        import("https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js"),
        import("https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js")
    ]).then(([fs, authMod]) => {
        window.syncManager.db = fs.getFirestore(app);
        window.syncManager.setDoc = fs.setDoc;
        window.syncManager.doc = fs.doc;
        window.syncManager.getDoc = fs.getDoc;

        const auth = authMod.getAuth(app);

        window.triggerSyncLogin = () => {
            if (window.syncManager.isLoggedIn) {
                alert("すでに自動ログインが完了しています！");
            } else {
                authMod.signInWithEmailAndPassword(auth, PRIVATE_EMAIL, PRIVATE_PASSWORD)
                    .catch(e => alert("ログイン失敗: " + e.code + "\n" + e.message));
            }
        };
        window.triggerSyncLogout = () => {
            alert("自動ログインモードのため、ログアウトは不要です。");
        };

        authMod.onAuthStateChanged(auth, (user) => {
            if (user) {
                window.syncManager.currentUser = user;
                window.syncManager.isLoggedIn = true;
                if (window.syncManager.onAuthChangeCallback) window.syncManager.onAuthChangeCallback(true);
                window.syncManager.updateLoginTriggerUI(true);

                if (window.syncManager.config) {
                    loadDataFromCloud();
                } else {
                    window.syncManager.syncStatus = 'ready';
                }
            } else {
                authMod.signInWithEmailAndPassword(auth, PRIVATE_EMAIL, PRIVATE_PASSWORD)
                    .catch((error) => {
                        console.error("Firebase自動ログイン失敗:", error);
                        window.syncManager.setStatusText('エラー', false);
                    });
            }
        });
    });
});

window.setupSyncSystem = function(config) {
    window.syncManager.config = config;
    if (config.loginTriggerId) {
        const triggerEl = document.getElementById(config.loginTriggerId);
        if (triggerEl) {
            triggerEl.onclick = () => {};
        }
    }

    window.syncManager.updateLoginTriggerUI(window.syncManager.isLoggedIn);

    if (window.syncManager.isLoggedIn) {
        loadDataFromCloud();
    }
};

async function loadDataFromCloud() {
    window.syncManager.syncStatus = 'loading';
    window.syncManager.setStatusText('読込中...');

    try {
        const { db, getDoc, doc, config } = window.syncManager;

        const pendingDataStr = localStorage.getItem('PendingCloudSave_' + config.fileName);
        if (pendingDataStr) {
            if (config.onLoad) config.onLoad(JSON.parse(pendingDataStr));
            window.syncManager.setStatusText('読込完了', true);
            window.syncManager.syncStatus = 'ready';
            window.triggerSyncSave();
            return;
        }

        const docRef = doc(db, "users", TARGET_UID, "renma_data", config.firestoreDoc);
        const docSnap = await getDoc(docRef);

        let loadedData = null;
        if (docSnap.exists()) {
            loadedData = docSnap.data().data;
        }

        if (config.onLoad) config.onLoad(loadedData);
        window.syncManager.setStatusText('読込完了', true);
    } catch (e) {
        console.error("Firebase読込エラー:", e);
        window.syncManager.setStatusText('エラー', true);
    } finally {
        window.syncManager.syncStatus = 'ready';
    }
}

window.triggerSyncSave = function() {
    if (!window.syncManager.isLoggedIn || !window.syncManager.config) return;
    if (window.syncManager.syncStatus !== 'ready') return;

    const dataToSave = window.syncManager.config.onSave();
    if (dataToSave) {
        localStorage.setItem('PendingCloudSave_' + window.syncManager.config.fileName, JSON.stringify(dataToSave));
    }

    if (window.syncManager.autoSaveTimer) clearTimeout(window.syncManager.autoSaveTimer);

    window.syncManager.autoSaveTimer = setTimeout(async () => {
        if (window.syncManager.syncStatus !== 'ready') return;

        window.syncManager.setStatusText('保存中...');

        try {
            const { db, setDoc, doc, config } = window.syncManager;
            await setDoc(doc(db, "users", TARGET_UID, "renma_data", config.firestoreDoc), {
                updatedAt: new Date(),
                data: dataToSave
            });
            window.syncManager.setStatusText('保存完了', true);
            localStorage.removeItem('PendingCloudSave_' + config.fileName);
        } catch (e) {
            console.error("Firebase保存エラー", e);
            window.syncManager.setStatusText('エラー', true);
        }
    }, 2000);
};

window.syncManager.loadSecondaryData = async function(fileName, firestoreDoc) {
    if (!this.isLoggedIn || !this.currentUser) return null;
    try {
        const docRef = this.doc(this.db, "users", TARGET_UID, "renma_data", firestoreDoc);
        const docSnap = await this.getDoc(docRef);
        return docSnap.exists() ? docSnap.data().data : null;
    } catch (e) {
        console.error("Secondary Cloud Load Error:", e);
        return null;
    }
};