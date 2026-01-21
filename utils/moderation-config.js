const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../data/moderation_config.json');

function loadConfig() {
    try {
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify({}, null, 2));
        }
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.error('Error loading moderation config:', error);
        return {};
    }
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    return config[guildId] || null;
}

function hasModerationPermission(member, guildId) {
    const guildConfig = getGuildConfig(guildId);
    if (!guildConfig || !guildConfig.roles || guildConfig.roles.length === 0) {
        return false;
    }
    return member.roles.cache.some(role => guildConfig.roles.includes(role.id));
}

function getLogChannel(guildId) {
    const guildConfig = getGuildConfig(guildId);
    return guildConfig ? guildConfig.logChannelId : null;
}

module.exports = {
    getGuildConfig,
    hasModerationPermission,
    getLogChannel
};

