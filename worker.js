// worker.js
// PapaParseをWeb Worker内でインポート
importScripts('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js');

const attributes = ['斬', '打', '突', '熱', '冷', '雷', '陽', '陰'];
const additionalAttributes = ['毒', '暗闇', 'スタン', 'マヒ', '眠り', '石化', '混乱', '魅了', '狂戦士', '気絶', '腕力', '体力', '器用さ', '素早さ', '知力', '精神', '愛', '魅力'];

let timeoutSignaled = false; // メインスレッドからの終了シグナルを受け取るためのフラグ

// Workerが持つデータストア
let workerDataStore = {
    mainArmor: [],
    subArmor: [],
    decorations: [],
    characterResistances: []
};

// CSVファイルをロードするユーティリティ関数（Worker内部用）
async function loadCSVFileInWorker(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const text = await response.text();
        const parsed = Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            transformHeader: (header) => header.trim()
        });

        if (parsed.errors.length > 0) {
            console.warn(`[Worker] CSV parsing warnings for ${url}:`, parsed.errors);
        }
        return parsed.data;
    } catch (error) {
        throw new Error(`Failed to load ${url} in worker: ${error.message}`);
    }
}

// メインスレッドからのメッセージリスナー
self.onmessage = async function(e) {
    const { type, payload } = e.data;

    if (type === 'init') {
        try {
            const { dataFiles } = payload;
            workerDataStore.mainArmor = await loadCSVFileInWorker(dataFiles.mainArmor);
            workerDataStore.subArmor = await loadCSVFileInWorker(dataFiles.subArmor);
            workerDataStore.decorations = await loadCSVFileInWorker(dataFiles.decorations);
            workerDataStore.characterResistances = await loadCSVFileInWorker(dataFiles.characterResistances);

            self.postMessage({ type: 'dataLoaded', message: 'Worker内でデータロードが完了しました。' });
            console.log("[Worker] All data loaded successfully.");
        } catch (error) {
            self.postMessage({ type: 'dataLoadError', payload: error.message });
            console.error("[Worker] Failed to load data during init:", error);
        }
        return;
    }

    if (type === 'terminate') {
        timeoutSignaled = true;
        console.log("[Worker] Terminate signal received.");
        return;
    }

    if (type === 'startSearch') {
        // [修正点] 新しい検索開始時にtimeoutSignaledをリセットする
        timeoutSignaled = false;

        const { excludeSettings, characterValues, characterAdjustmentValues, targetValues, statusAilmentSettings, fixedEquipments, itemQuantities, sortSettings } = payload;

        const results = [];
        const maxResults = 20;
        const charToProcess = ['キャラ１', 'キャラ２', 'キャラ３', 'キャラ４', 'キャラ５'];

        const mainArmor = workerDataStore.mainArmor;
        const subArmor = workerDataStore.subArmor;
        const decorations = workerDataStore.decorations;

        if (mainArmor.length === 0 || subArmor.length === 0 || decorations.length === 0) {
            self.postMessage({ type: 'error', payload: 'Workerにデータが読み込まれていません。メインスレッドで再試行ボタンを押してデータをロードしてください。' });
            return;
        }

        const availableMain = mainArmor.filter(a => !excludeSettings.main.includes(a['名称']));
        const availableSub = subArmor.filter(a => !excludeSettings.sub.includes(a['名称']));
        const availableDeco = decorations.filter(a => !excludeSettings.deco.includes(a['名称']));

        let iterationCounter = 0;
        const REPORT_INTERVAL = 10000;

        const findTeamCombinations = (charIndex, currentTeamCombo, currentRemainingQuantities) => {
            if (timeoutSignaled) return;
            if (results.length >= maxResults) return;

            iterationCounter++;
            if (iterationCounter % REPORT_INTERVAL === 0) {
                self.postMessage({ type: 'progress', message: `探索中... (現在の候補数: ${results.length})` });
                if (timeoutSignaled) return;
            }

            if (charIndex === charToProcess.length) {
                results.push([...currentTeamCombo]);
                return;
            }

            const currentCharName = charToProcess[charIndex];
            const currentCharValues = characterValues[currentCharName];
            const currentStatusAilmentSetting = statusAilmentSettings[currentCharName];
            const fixed = fixedEquipments[currentCharName];

            const charMainList = fixed.main
                ? availableMain.filter(a => a['名称'] === fixed.main)
                : availableMain;
            const charSubList = fixed.sub
                ? availableSub.filter(a => a['名称'] === fixed.sub)
                : availableSub;
            const charDecoList = fixed.deco
                ? availableDeco.filter(a => a['名称'] === fixed.deco)
                : availableDeco;

            for (const main of charMainList) {
                if (timeoutSignaled) return;
                const mainKey = `main_${main['名称']}`;
                if (currentRemainingQuantities[mainKey] !== undefined && currentRemainingQuantities[mainKey] < 1) continue;

                for (const sub of charSubList) {
                    if (timeoutSignaled) return;
                    const subKey = `sub_${sub['名称']}`;
                    if (currentRemainingQuantities[subKey] !== undefined && currentRemainingQuantities[subKey] < 1) continue;

                    for (const deco of charDecoList) {
                        if (timeoutSignaled) return;
                        const decoKey = `deco_${deco['名称']}`;
                        // この所持数チェックはdeco['所持数']がundefinedまたはInfinityでない場合のみ行われるべき
                        if (deco['所持数'] !== undefined && deco['所持数'] !== Infinity) {
                             if (currentRemainingQuantities[decoKey] !== undefined && currentRemainingQuantities[decoKey] < 1) continue;
                        }


                        let meetsConditions = true;
                        const charTotals = {};

                        attributes.forEach(attr => {
                            const total = (parseInt(main[attr] || 0)) + (parseInt(sub[attr] || 0)) + (parseInt(deco[attr] || 0)) + currentCharValues[attr] - characterAdjustmentValues[currentCharName][attr];
                            if (total < targetValues[attr]) { meetsConditions = false; }
                            charTotals[attr] = (parseInt(main[attr] || 0)) + (parseInt(sub[attr] || 0)) + (parseInt(deco[attr] || 0));
                        });

                        additionalAttributes.forEach(attr => {
                            charTotals[attr] = (parseInt(main[attr] || 0)) + (parseInt(sub[attr] || 0)) + (parseInt(deco[attr] || 0));
                        });

                        if (currentStatusAilmentSetting.selectedTypes.length > 0 && currentStatusAilmentSetting.value > 0) {
                            currentStatusAilmentSetting.selectedTypes.forEach(ailmentType => {
                                const statusAilmentTotal = (parseInt(main[ailmentType] || 0)) + (parseInt(sub[ailmentType] || 0)) + (parseInt(deco[ailmentType] || 0));
                                if (statusAilmentTotal < currentStatusAilmentSetting.value) { meetsConditions = false; }
                                charTotals[ailmentType] = statusAilmentTotal;
                            });
                        }

                        if (meetsConditions) {
                            const nextRemainingQuantities = { ...currentRemainingQuantities };
                            if (main['所持数'] !== undefined && main['所持数'] !== Infinity) {
                                nextRemainingQuantities[mainKey] = (nextRemainingQuantities[mainKey] || 0) > 0 ? nextRemainingQuantities[mainKey] - 1 : 0;
                            }
                            if (sub['所持数'] !== undefined && sub['所持数'] !== Infinity) {
                                nextRemainingQuantities[subKey] = (nextRemainingQuantities[subKey] || 0) > 0 ? nextRemainingQuantities[subKey] - 1 : 0;
                            }
                            // typo修正: '所氏数' -> '所持数'
                            if (deco['所持数'] !== undefined && deco['所持数'] !== Infinity) {
                                nextRemainingQuantities[decoKey] = (nextRemainingQuantities[decoKey] || 0) > 0 ? nextRemainingQuantities[decoKey] - 1 : 0;
                            }

                            findTeamCombinations(
                                charIndex + 1,
                                [...currentTeamCombo, {
                                    character: currentCharName,
                                    mainArmor: main['名称'],
                                    subArmor: sub['名称'],
                                    decoration: deco['名称'],
                                    totals: charTotals
                                }],
                                nextRemainingQuantities
                            );
                        }
                    }
                }
            }
        };

        try {
            findTeamCombinations(0, [], { ...itemQuantities });

            if (sortSettings && sortSettings.priority1) {
                results.sort((a, b) => {
                    let compareValue = 0;
                    const aVal = a[0]?.totals[sortSettings.priority1] || 0;
                    const bVal = b[0]?.totals[sortSettings.priority1] || 0;
                    compareValue = sortSettings.order1 === 'asc' ? aVal - bVal : bVal - aVal;

                    if (compareValue !== 0) return compareValue;

                    if (sortSettings.priority2) {
                        const aVal2 = a[0]?.totals[sortSettings.priority2] || 0;
                        const bVal2 = b[0]?.totals[sortSettings.priority2] || 0;
                        compareValue = sortSettings.order2 === 'asc' ? aVal2 - bVal2 : bVal2 - aVal2;
                        if (compareValue !== 0) return compareValue;

                        if (sortSettings.priority3) {
                            const aVal3 = a[0]?.totals[sortSettings.priority3] || 0;
                            const bVal3 = b[0]?.totals[sortSettings.priority3] || 0;
                            compareValue = sortSettings.order3 === 'asc' ? aVal3 - bVal3 : bVal3 - aVal3;
                        }
                    }
                    return compareValue;
                });
            }

            if (!timeoutSignaled) {
                self.postMessage({ type: 'results', payload: results });
            } else {
                console.log("[Worker] Search completed after terminate signal. Not sending results.");
            }
        } catch (error) {
            console.error("[Worker] Error during search:", error);
            self.postMessage({ type: 'error', payload: error.message || 'Worker内部で不明なエラーが発生しました。' });
        }
    }
};