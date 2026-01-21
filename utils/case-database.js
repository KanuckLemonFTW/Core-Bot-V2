const fs = require('fs');
const path = require('path');

const CASE_DB_FILE = path.join(__dirname, '../data/case_database.json');

// Initialize database if it doesn't exist
if (!fs.existsSync(CASE_DB_FILE)) {
    fs.writeFileSync(CASE_DB_FILE, JSON.stringify({}, null, 2));
}

function loadDatabase() {
    try {
        const data = fs.readFileSync(CASE_DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading case database:', error);
        return {};
    }
}

function saveDatabase(data) {
    try {
        fs.writeFileSync(CASE_DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving case database:', error);
    }
}

function getNextCaseNumber(guildId, prefix, isGlobal = false) {
    const db = loadDatabase();
    
    // For global cases (like PNET), check across all guilds
    if (isGlobal) {
        let maxNumber = 0;
        for (const gId in db) {
            if (db[gId] && Array.isArray(db[gId])) {
                const prefixCases = db[gId].filter(c => {
                    // Only match new format: PNET-#### or CASE-#### (exactly prefix-#### format)
                    if (!c.caseId) return false;
                    const regex = new RegExp(`^${prefix}-\\d{4}$`);
                    return regex.test(c.caseId);
                });
                prefixCases.forEach(c => {
                    const regex = new RegExp(`^${prefix}-(\\d{4})$`);
                    const match = c.caseId.match(regex);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        // Only consider numbers less than 1000 (ignore high numbers from old format artifacts)
                        if (num > 0 && num < 1000 && num > maxNumber) {
                            maxNumber = num;
                        }
                    }
                });
            }
        }
        // If no valid cases found, start at 1
        if (maxNumber === 0) {
            return 1;
        }
        return maxNumber + 1;
    }
    
    // For per-guild cases (like CASE for blacklist)
    if (!db[guildId]) {
        db[guildId] = [];
    }
    
    // Find all cases with this prefix for this guild - only match new format
    const prefixCases = db[guildId].filter(c => {
        // Only match new format: CASE-#### (exactly prefix-#### format)
        if (!c.caseId) return false;
        const regex = new RegExp(`^${prefix}-\\d{4}$`);
        return regex.test(c.caseId);
    });
    
    // Extract numbers and find the highest
    // Ignore cases with numbers >= 1000 (treat as old/invalid format)
    let maxNumber = 0;
    prefixCases.forEach(c => {
        const regex = new RegExp(`^${prefix}-(\\d{4})$`);
        const match = c.caseId.match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            // Only consider numbers less than 1000 (ignore high numbers from old format artifacts)
            if (num > 0 && num < 1000 && num > maxNumber) {
                maxNumber = num;
            }
        }
    });
    
    // If no valid cases found, start at 1
    if (maxNumber === 0) {
        return 1;
    }
    
    // Return next number
    return maxNumber + 1;
}

function generateCaseId(guildId, punishmentType) {
    // Determine prefix based on punishment type
    let prefix;
    let isGlobal = false;
    
    if (punishmentType === 'global_ban' || punishmentType === 'global_unban') {
        prefix = 'PNET';
        isGlobal = true; // Global bans use global sequential numbering
    } else if (punishmentType === 'blacklist' || punishmentType === 'unblacklist') {
        prefix = 'CASE';
        isGlobal = false; // Blacklist uses per-guild sequential numbering
    } else {
        // Default format for other types
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const guildShort = guildId.slice(-6);
        return `CASE-${guildShort}-${timestamp}-${random}`;
    }
    
    // Get next sequential number
    const caseNumber = getNextCaseNumber(guildId, prefix, isGlobal);
    
    // Format as PNET-0000 or CASE-0000
    return `${prefix}-${caseNumber.toString().padStart(4, '0')}`;
}

function addCase(guildId, caseData) {
    const db = loadDatabase();
    if (!db[guildId]) {
        db[guildId] = [];
    }
    
    const caseId = generateCaseId(guildId, caseData.punishmentType);
    const caseEntry = {
        caseId,
        ...caseData,
        timestamp: Date.now()
    };
    
    db[guildId].push(caseEntry);
    saveDatabase(db);
    
    return caseId;
}

function getCaseByCaseId(guildId, caseId) {
    const db = loadDatabase();
    if (!db[guildId]) {
        return null;
    }
    
    return db[guildId].find(c => c.caseId === caseId) || null;
}

function getCasesByUserId(guildId, userId) {
    const db = loadDatabase();
    if (!db[guildId]) {
        return [];
    }
    
    return db[guildId].filter(c => c.userId === userId);
}

function getCasesByType(guildId, punishmentType) {
    const db = loadDatabase();
    if (!db[guildId]) {
        return [];
    }
    
    return db[guildId].filter(c => c.punishmentType === punishmentType);
}

// Clean up old punishment cases (older than 14 days)
// Only removes actual punishments, not all case types
function cleanOldCases() {
    const db = loadDatabase();
    const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    
    // Punishment types that should be cleaned up after 14 days
    const punishmentTypes = ['warning', 'timeout', 'blacklist', 'global_ban', 'global_rolestripe', 'purge'];
    
    for (const guildId in db) {
        if (db[guildId] && Array.isArray(db[guildId])) {
            db[guildId] = db[guildId].filter(c => {
                // Keep cases that are:
                // 1. Not a punishment type, OR
                // 2. A punishment type but less than 14 days old
                if (!punishmentTypes.includes(c.punishmentType)) {
                    return true; // Keep non-punishment cases
                }
                return c.timestamp > fourteenDaysAgo; // Only keep punishments less than 14 days old
            });
        }
    }
    
    saveDatabase(db);
}

// Run cleanup on startup and set up periodic cleanup (every 24 hours)
cleanOldCases();
setInterval(cleanOldCases, 24 * 60 * 60 * 1000); // Run every 24 hours

module.exports = {
    generateCaseId,
    addCase,
    getCaseByCaseId,
    getCasesByUserId,
    getCasesByType
};

