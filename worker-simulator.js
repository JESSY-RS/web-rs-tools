// worker-generator.js

// グローバルなデータベース（メインスレッドから受け取る）
let db = { styles: [], skills: {}, abilities: {}, addInfo: {}, chars: [] };

// 定数定義（メインスレッドと共通）
const EXCLUDED_SKILLS = ['エクストラ餅つき'];
const EXF_POINTS = {
    '極小': 0.12, 'EXF1': 0.12,
    '小': 0.25, 'EXF2': 0.25,
    '中': 0.50,
    '大': 0.75, '専用': 0.75,
    '特大': 1.00
};

// ヘルパー関数群（シミュレーション用）
function parseAttackCount(text) {
    if (!text) return 0;
    let m = text.match(/攻撃する(?:\s*[\(（](\d+)[-〜](\d+)回[\)）])/);
    if (m) return parseInt(m[2], 10);
    m = text.match(/攻撃する(?:\s*[\(（](\d+)回[\)）])/);
    if (m) return parseInt(m[1], 10);
    if (text.match(/(?:攻撃する|全体攻撃する|範囲攻撃する|ランダムな敵に攻撃する)/)) return 1;
    return 0;
}

function findLinkedSkills(text) {
    const links = [];
    if (!text) return links;
    const regex = /[「『]([^」』]+)[」』]/g;
    const matches = [...text.matchAll(regex)];
    for (const m of matches) {
        const name = m[1];
        const idx = m.index + m[0].length;
        const ctx = text.substring(idx, idx + 20);
        let count = 1;
        if (ctx.includes('発動')) {
            const cm = ctx.match(/(\d+)回/);
            if (cm) count = parseInt(cm[1], 10);
            links.push({ name, count });
        }
    }
    return links;
}

function findGrantedAbilities(text) {
    const granted = [];
    if (!text) return granted;
    const regex = /[「『]([^」』]+)[」』](?:.*?)を付与する/g;
    for (const m of [...text.matchAll(regex)]) {
        if (db.abilities[m[1]]) granted.push(m[1]);
    }
    return granted;
}

function getSkillSequence(activeSkill, attackerContext, visited = new Set(), depth = 0, sourceLabel = '') {
    if (depth > 10) return [];
    let sequence = [];

    // 1. メイン/リンクスキル自体の処理
    if (activeSkill) {
        const desc = activeSkill['効果詳細'] || '';
        const selfHits = parseAttackCount(desc);
        
        if (selfHits > 0) {
            const label = sourceLabel ? `${sourceLabel}→${activeSkill['スキル名']}` : activeSkill['スキル名'];
            sequence.push({
                name: activeSkill['スキル名'],
                hits: selfHits,
                isAction: false,
                label: `${label}(${selfHits})`
            });
        }

        const links = findLinkedSkills(desc);
        links.forEach(link => {
            if (visited.has(link.name)) return;
            const ls = db.skills[link.name];
            if (ls) {
                const newVisited = new Set(visited); newVisited.add(activeSkill['スキル名']);
                for (let i = 0; i < link.count; i++) {
                    sequence.push(...getSkillSequence(ls, attackerContext, newVisited, depth + 1, sourceLabel));
                }
            }
        });
    }

    // 2. アビリティ追撃の探索
    if (depth === 0 && attackerContext && attackerContext.data) {
        const style = attackerContext.data.fullStyle;
        let abilities = [];
        ['アビリティ1', 'アビリティ2', 'アビリティ3'].forEach(k => {
            if (style[k] && db.abilities[style[k]]) abilities.push({ name: style[k], data: db.abilities[style[k]], src: 'ability' });
        });

        let i = 0;
        while(i < abilities.length){
            const gr = findGrantedAbilities(abilities[i].data['効果詳細']);
            gr.forEach(g => {
                if(!abilities.some(a=>a.name===g)) abilities.push({ name: g, data: db.abilities[g], src: 'granted' });
            });
            i++;
        }

        abilities.forEach(item => {
            const desc = item.data['効果詳細'] || '';
            if (desc.match(/攻撃((命中)?時)|タイプが「攻撃」|技・術を命中させた時/)) {
                const links = findLinkedSkills(desc);
                links.forEach(link => {
                    const ls = db.skills[link.name];
                    if (ls) {
                        const newVisited = new Set(visited); newVisited.add(item.name);
                        const prefix = item.src === 'granted' ? `[状態:${item.name}]` : `[${item.name}]`;
                        for(let k=0; k<link.count; k++) {
                            const childSeq = getSkillSequence(ls, attackerContext, newVisited, depth + 1, prefix);
                            if(childSeq.length > 0) {
                                childSeq[0].isAction = true; 
                                sequence.push(...childSeq);
                            }
                        }
                    }
                });
            }
        });
    }
    return sequence;
}

// シミュレーションコアロジック (Worker版)
function simulateTeamDamage(team) {
    let totalDamage = 0;
    let totalExfPtForDiff = 0;
    let totalActionCount = 0;
    let contributingExfTypes = new Map();

    if (team.length === 0) return { totalDamage: 0, totalExfPt: 0, contributors: new Map(), actionCount: 0 };

    try {
        const attackers = team.filter(m => m.type === 'atk');
        const isMultiAttacker = attackers.length > 1;

        attackers.forEach((attacker, index) => {
            const enableCap = (!isMultiAttacker) || (isMultiAttacker && index > 0);
            
            if (enableCap && totalDamage >= 100) return;

            if (!attacker.skill) return;

            const sData = db.skills[attacker.skill];
            const mySystem = (sData && sData['系統'] ? sData['系統'].trim() : '');
            const myAttributes = (sData && sData['属性1'] ? [sData['属性1'].trim()] : []).concat(sData && sData['属性2'] ? [sData['属性2'].trim()] : []);
            const skillTech = (sData && sData['技術'] ? sData['技術'].trim() : '');
            const skillDirect = (sData && (sData['区分'] || sData['方法']) ? (sData['区分']||sData['方法']).trim() : '');

            let myPoints = [];
            const soulPt = parseFloat(attacker.soul); if (soulPt > 0) myPoints.push({ type: '魂', pt: soulPt, srcIdx: attacker.idx });
            const dressPt = parseFloat(attacker.dress); if (dressPt > 0) myPoints.push({ type: 'ドレス', pt: dressPt, srcIdx: attacker.idx });
            if (attacker.weaponEx) myPoints.push({ type: '専用武器', pt: 0.75, srcIdx: attacker.idx });

            const visitedEffects = new Set();
            team.forEach(member => {
                const resolveSkillInfo = (name) => {
                        const clean = name.replace(/[\(（][^\)）]+[\)）]/, '').trim();
                        let inner = null;
                        const paren = name.match(/[\(（]([^\)）]+)[\)）]/);
                        if (paren) inner = paren[1].trim();
                        let info = db.skills[name] || db.abilities[name];
                        let rName = name;
                        if (!info && inner) { info = db.skills[inner] || db.abilities[inner]; if(info) rName = inner; }
                        if (!info && clean) { info = db.skills[clean] || db.abilities[clean]; if(info) rName = clean; }
                        return { info, name: rName };
                };
                const countRecursiveHits = (txt, visited = new Set()) => {
                    if (!txt || visited.has(txt)) return 0;
                    visited.add(txt);
                    let count = 0;
                    const match = txt.match(/攻撃する[\(（]([0-9]+)/);
                    if (match) count += parseInt(match[1]);
                    const refs = txt.matchAll(/「([^」]+)」/g);
                    for (const r of refs) { const { info } = resolveSkillInfo(r[1]); if (info) count += countRecursiveHits(info['効果詳細'], visited); }
                    return count;
                };
                const checkEffects = (sourceName, text, sourceOwner, parentMultiplier = 1) => {
                    if (!text) return;
                    const sig = sourceName + ":" + text.length + ":" + parentMultiplier;
                    if (visitedEffects.has(sig)) return;
                    visitedEffects.add(sig);
                    let localHitCount = countRecursiveHits(text) || 1;
                    const getAnalysisContext = (idx) => {
                        const pre = text.substring(0, idx);
                        const lastBr = pre.lastIndexOf('[');
                        let timing = null;
                        if (lastBr !== -1) { const cl = pre.indexOf(']', lastBr); if (cl !== -1) timing = pre.substring(lastBr + 1, cl); }
                        if (timing && ['終了時', '気絶時', '敗北時', '受ける', '被弾'].some(kw => timing.includes(kw))) return null;
                        let ls = text.lastIndexOf('\n', idx); ls = ls === -1 ? 0 : ls + 1;
                        let le = text.indexOf('\n', idx); le = le === -1 ? text.length : le;
                        return { line: text.substring(ls, le), timing };
                    };
                    const isTargetValid = (line) => {
                        if (line.includes('全体') || line.includes('敵')) return true;
                        const hasSelf = line.includes('自身');
                        const isMe = (sourceOwner.idx === attacker.idx);
                        if (!isMe && hasSelf && !line.includes('味方') && !line.includes('対象')) return false;
                        return true;
                    };
                    const matches = text.matchAll(/エクストラフォース\(([^/]+)\/([^)]+)\)/g);
                    for (const m of matches) {
                        const ctx = getAnalysisContext(m.index);
                        if (!ctx || !isTargetValid(ctx.line)) continue;
                        const cond = m[1].trim(); const valStr = m[2].trim();
                        let match = false;
                        const ATTRIBUTE_TYPES = ['斬', '打', '突', '熱', '冷', '雷', '陽', '陰'];
                        const SYSTEM_TYPES = ['剣', '大剣', '斧', '棍棒', '体術', '銃', '槍', '小剣', '弓', '杖', '火', '水', '風', '土', '光', '闇'];
                        if (cond === 'Critical' || cond === 'Weak') match = true;
                        else if (cond === '技' || cond === '術') { if (skillTech === cond) match = true; }
                        else if (cond === '直接' || cond === '間接') { if (skillDirect.includes(cond)) match = true; }
                        else if (ATTRIBUTE_TYPES.includes(cond)) { if (myAttributes.includes(cond)) match = true; }
                        else if (SYSTEM_TYPES.includes(cond)) { if (mySystem === cond || myAttributes.includes(cond)) match = true; }
                        if (match) { const pt = EXF_POINTS[valStr] || 1.0; myPoints.push({ type: cond, pt, srcIdx: sourceOwner.idx }); }
                    }
                    const sm = text.matchAll(/「([^」]+)」/g);
                    for (const m of sm) {
                        const { info, name: tName } = resolveSkillInfo(m[1]);
                        if (info && info['効果詳細']) {
                            const ctx = getAnalysisContext(m.index);
                            if (ctx && isTargetValid(ctx.line)) { const mult = parentMultiplier * localHitCount; checkEffects(`${sourceName}->${tName}`, info['効果詳細'], sourceOwner, mult); }
                        }
                    }
                };
                ['アビリティ1', 'アビリティ2', 'アビリティ3'].forEach(k => { const an = member.data.fullStyle[k]; if (an && db.abilities[an]) checkEffects(an, db.abilities[an]['効果詳細'], member); });
                if (member.skill && db.skills[member.skill]) { checkEffects(member.skill, db.skills[member.skill]['効果詳細'], member); }
            });

            const maxMap = new Map(); myPoints.forEach(p => { const curr = maxMap.get(p.type); if (!curr || p.pt > curr.pt) maxMap.set(p.type, p); });
            let totalPt = 0; 
            maxMap.forEach((v, k) => { totalPt += v.pt; if (!contributingExfTypes.has(v.srcIdx)) contributingExfTypes.set(v.srcIdx, new Set()); contributingExfTypes.get(v.srcIdx).add(k); });
            totalExfPtForDiff += totalPt;
            const dmgBonus = Math.floor(totalPt);

            const sequence = getSkillSequence(sData, attacker);
            
            let executedActions = 0;
            if (sequence.length > 0) executedActions++;

            for (const act of sequence) {
                if (enableCap && totalDamage >= 100) break; 
                totalDamage += act.hits * (1 + dmgBonus);
                if (act.isAction) executedActions++;
            }
            totalActionCount += executedActions;
        });

        team.filter(m => m.type === 'sup' && m.skill).forEach(() => { totalActionCount += 1; });

    } catch (e) {
        console.error("Worker Simulation Error", e);
    }

    return { totalDamage, totalExfPt: totalExfPtForDiff, contributors: contributingExfTypes, actionCount: totalActionCount };
}

// メッセージハンドリング
self.onmessage = async function(e) {
    const { type, payload } = e.data;

    if (type === 'init') {
        db = payload;
        self.postMessage({ type: 'ready' });
    } else if (type === 'startSearch') {
        const { fixedTeam, emptySlots, attackerIsFast } = payload;
        
        // 1. サポート候補の分析
        const supportCandidates = db.chars.filter(c => c.isSupport);
        // Worker内ではDB再構築済みなので、fixedTeam内のdataも参照可能だが
        // メインスレッドから渡されたオブジェクトのプロトタイプチェーン等は切れているので注意
        // simulateTeamDamage内で db.skills[] を参照するのでOK

        const baseRes = simulateTeamDamage(fixedTeam);
        const flatCandidates = [];
        let processedCount = 0;
        const chunkSize = 50; // チャンクサイズ

        // 非同期ループ処理
        for (let i = 0; i < supportCandidates.length; i++) {
            if (i % chunkSize === 0) {
                self.postMessage({ type: 'progress', message: `分析中... ${Math.floor((i / supportCandidates.length) * 100)}%` });
                await new Promise(r => setTimeout(r, 0)); // イベントループを回す
            }

            const cand = supportCandidates[i];

            // Pattern 1: Ability Only
            let isPurePassive = true;
            ['アビリティ1', 'アビリティ2', 'アビリティ3'].forEach(k => {
                const aName = cand.fullStyle[k];
                if(!aName || !db.abilities[aName]) return;
                const desc = db.abilities[aName]['効果詳細'];
                const matches = [...desc.matchAll(/エクストラフォース/g)];
                for(const m of matches) {
                    const pre = desc.substring(0, m.index);
                    if(pre.match(/発動後|攻撃((命中)?時)|命じ(た|ている)場合|攻撃(する)?たび/)) isPurePassive = false; 
                }
            });

            if (isPurePassive) {
                let resAbility = simulateTeamDamage([...fixedTeam, { idx: 99, data: cand, type: 'sup', weaponEx: false, dress: '0', soul: '0', skill: '' }]);
                if (resAbility.totalExfPt > baseRes.totalExfPt + 0.01) {
                    flatCandidates.push({ char: cand, skill: '', diff: resAbility.totalExfPt - baseRes.totalExfPt, isAbility: true, exfLabel: Array.from(resAbility.contributors.get(99) || []).join(', ') });
                }
            }

            // Pattern 2: Skill (Fast + NoPrep)
            if (!attackerIsFast) {
                const sOpts = ['スキル1', 'スキル2', 'スキル3'].map(k => cand.fullStyle[k]).filter(s=>s && !EXCLUDED_SKILLS.includes(s));
                let bestSkill = { name: '', diff: -1, exfLabel: '' };
                for (const sName of sOpts) {
                    const sData = db.skills[sName];
                    if (!sData) continue;
                    if (!(sData['行動順']||'').includes('ファスト')) continue;
                    if ((sData['準備']||'') !== '') continue;
                    if ((sData['タイプ']||'').includes('攻撃') || parseAttackCount(sData['効果詳細']) > 0) continue;

                    let res = simulateTeamDamage([...fixedTeam, { idx: 99, data: cand, type: 'sup', weaponEx: false, dress: '0', soul: '0', skill: sName }]);
                    const d = res.totalExfPt - baseRes.totalExfPt;
                    if (d > bestSkill.diff) bestSkill = { name: sName, diff: d, exfLabel: Array.from(res.contributors.get(99) || []).join(', ') };
                }
                if (bestSkill.name && bestSkill.diff > 0.01) flatCandidates.push({ char: cand, skill: bestSkill.name, diff: bestSkill.diff, isAbility: false, exfLabel: bestSkill.exfLabel });
            }
        }

        const abilityOnlyCandidates = flatCandidates.filter(c => c.isAbility);
        const skillCandidates = flatCandidates.filter(c => !c.isAbility).sort((a, b) => b.diff - a.diff).slice(0, 15);
        const topCandidates = [...abilityOnlyCandidates, ...skillCandidates];

        if (topCandidates.length === 0) {
            self.postMessage({ type: 'done', results: [] });
            return;
        }

        // 2. 組み合わせ検索
        self.postMessage({ type: 'progress', message: `組み合わせを検索中...` });
        const results = [];
        const needed = emptySlots.length;

        function combine(currentSet, startIdx) {
            if (currentSet.length === needed) {
                const simTeam = [...fixedTeam];
                currentSet.forEach((cand) => {
                    simTeam.push({ idx: 0, data: cand.char, type: 'sup', weaponEx: false, dress: '0', soul: '0', skill: cand.skill });
                });
                const res = simulateTeamDamage(simTeam);
                if (res.totalDamage >= 100) {
                        results.push({ 
                            damage: res.totalDamage, 
                            members: currentSet, 
                            actionCount: res.actionCount, 
                            teamCount: simTeam.length,
                            exfPoint: res.totalExfPt
                        });
                }
                return;
            }
            for (let i = startIdx; i < topCandidates.length; i++) {
                const cand = topCandidates[i];
                if (!currentSet.some(m => m.char.charName === cand.char.charName)) combine([...currentSet, cand], i + 1);
            }
        }
        
        // 再帰処理は重いが、topCandidatesを絞っているので同期処理でいける可能性が高い
        // もしここでスタックするなら再帰をループ+awaitに変える必要があるが、
        // 候補数(max 15+alpha) * needed(max 4) なら数千通り程度なので一瞬
        combine([], 0);

        results.sort((a, b) => {
            if (a.actionCount !== b.actionCount) return a.actionCount - b.actionCount;
            if (Math.floor(b.damage) !== Math.floor(a.damage)) return b.damage - a.damage;
            if (Math.abs(b.exfPoint - a.exfPoint) > 0.01) return b.exfPoint - a.exfPoint;
            return a.teamCount - b.teamCount;
        });

        self.postMessage({ type: 'done', results: results });
    }
};