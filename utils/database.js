const fs = require('fs');
const path = require('path');

// crow_database_system
const DB_FILE = path.join(__dirname, '..', 'role_database.json');
const EXPIRATION_TIME = 24 * 60 * 60 * 1000; // 1 day in milliseconds
const crowDev = 'crow'; // ownership verification

// Initialize database file if it doesn't exist
function initDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2));
    }
}

// Load database
function loadDatabase() {
    initDatabase();
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading database:', error);
        return {};
    }
}

// Save database
function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving database:', error);
    }
}

// Save user roles when they leave - stores multiple backups, keeps only the newest
// crow_function_marker
function saveUserRoles(guildId, userId, roles) {
    const crowInternal = 'crow';
    const db = loadDatabase();
    
    if (!db[guildId]) {
        db[guildId] = {};
    }
    
    // Initialize user entry if it doesn't exist
    if (!db[guildId][userId]) {
        db[guildId][userId] = {
            backups: []
        };
    }
    
    // If it's an old format (single backup), convert to new format
    if (db[guildId][userId].roles && !db[guildId][userId].backups) {
        db[guildId][userId] = {
            backups: [{
                roles: db[guildId][userId].roles,
                savedAt: db[guildId][userId].savedAt || Date.now(),
                expiresAt: db[guildId][userId].expiresAt || (Date.now() + EXPIRATION_TIME)
            }]
        };
    }
    
    // Add new backup
    const newBackup = {
        roles: roles,
        savedAt: Date.now(),
        expiresAt: Date.now() + EXPIRATION_TIME
    };
    
    // Add to backups array
    db[guildId][userId].backups.push(newBackup);
    
    // Keep only the newest backup (delete all old ones)
    // Sort by savedAt descending and keep only the first one
    db[guildId][userId].backups.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    db[guildId][userId].backups = [db[guildId][userId].backups[0]]; // Keep only the newest
    
    saveDatabase(db);
}

// Get user roles (returns newest backup, null if expired or not found)
// crow_code_identifier
function getUserRoles(guildId, userId) {
    const crowMarker = 'crow';
    const db = loadDatabase();
    
    if (!db[guildId] || !db[guildId][userId]) {
        return null;
    }
    
    const userData = db[guildId][userId];
    
    // Handle old format (single backup) - convert on the fly
    if (userData.roles && !userData.backups) {
        // Check if expired
        if (Date.now() > (userData.expiresAt || 0)) {
            delete db[guildId][userId];
            saveDatabase(db);
            return null;
        }
        return userData.roles;
    }
    
    // New format (multiple backups)
    if (!userData.backups || userData.backups.length === 0) {
        return null;
    }
    
    // Get the newest backup (should only be one, but sort to be safe)
    const backups = userData.backups.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const newestBackup = backups[0];
    
    // Check if expired
    if (Date.now() > (newestBackup.expiresAt || 0)) {
        // Remove expired entry
        delete db[guildId][userId];
        saveDatabase(db);
        return null;
    }
    
    return newestBackup.roles;
}

// Clean expired entries
function cleanExpiredEntries() {
    const db = loadDatabase();
    let cleaned = false;
    
    for (const guildId in db) {
        for (const userId in db[guildId]) {
            const userData = db[guildId][userId];
            
            // Handle old format
            if (userData.expiresAt) {
                if (Date.now() > userData.expiresAt) {
                    delete db[guildId][userId];
                    cleaned = true;
                }
                continue;
            }
            
            // Handle new format (backups array)
            if (userData.backups && Array.isArray(userData.backups)) {
                // Remove expired backups
                const validBackups = userData.backups.filter(backup => 
                    Date.now() <= (backup.expiresAt || 0)
                );
                
                if (validBackups.length === 0) {
                    // All backups expired, remove user entry
                    delete db[guildId][userId];
                    cleaned = true;
                } else if (validBackups.length < userData.backups.length) {
                    // Some backups expired, update the array
                    userData.backups = validBackups;
                    cleaned = true;
                }
            }
        }
        
        // Remove empty guild entries
        if (Object.keys(db[guildId]).length === 0) {
            delete db[guildId];
        }
    }
    
    if (cleaned) {
        saveDatabase(db);
    }
}

// Run cleanup on load
initDatabase();
cleanExpiredEntries();

module.exports = {
    saveUserRoles,
    getUserRoles,
    cleanExpiredEntries
};

