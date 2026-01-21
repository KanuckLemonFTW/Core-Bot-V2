const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('punishmentlookup')
        .setDescription('Look up all punishments for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to look up punishments for')
                .setRequired(true)),
    async execute(interaction, client, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser('user');
        const fs = require('fs');
        const path = require('path');
        const CASE_DB_FILE = path.join(__dirname, '../../data/case_database.json');

        if (!fs.existsSync(CASE_DB_FILE)) {
            const noPunishmentsEmbed = new EmbedBuilder()
                .setTitle('📋 Punishment History')
                .setDescription(`No punishments found for ${targetUser.tag}.`)
                .setColor('#808080')
                .setTimestamp();
            
            return interaction.editReply({ embeds: [noPunishmentsEmbed] });
        }

        try {
            const db = JSON.parse(fs.readFileSync(CASE_DB_FILE, 'utf8'));
            const allPunishments = [];
            
            // Search all guilds for punishments for this user
            for (const gId in db) {
                if (db[gId] && Array.isArray(db[gId])) {
                    const userCases = db[gId].filter(c => c.userId === targetUser.id);
                    allPunishments.push(...userCases);
                }
            }

            // Filter out non-punishment types (like purge, unmute, unblacklist, global_unban)
            const punishmentTypes = ['warning', 'timeout', 'blacklist', 'global_ban', 'global_rolestripe'];
            const punishments = allPunishments.filter(c => punishmentTypes.includes(c.punishmentType));

            // Sort by timestamp (most recent first)
            punishments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            if (punishments.length === 0) {
                const noPunishmentsEmbed = new EmbedBuilder()
                    .setTitle('📋 Punishment History')
                    .setDescription(`No punishments found for ${targetUser.tag}.`)
                    .setColor('#808080')
                    .setTimestamp();
                
                return interaction.editReply({ embeds: [noPunishmentsEmbed] });
            }

            // Group punishments by type
            const groupedPunishments = {
                warning: [],
                timeout: [],
                blacklist: [],
                global_ban: [],
                global_rolestripe: []
            };

            punishments.forEach(p => {
                if (groupedPunishments[p.punishmentType]) {
                    groupedPunishments[p.punishmentType].push(p);
                }
            });

            // Build embed with punishment history
            const embed = new EmbedBuilder()
                .setTitle(`📋 Punishment History - ${targetUser.tag}`)
                .setDescription(`Total Punishments: **${punishments.length}**`)
                .setThumbnail(targetUser.displayAvatarURL())
                .setColor('#FFA500')
                .setTimestamp()
                .setFooter({ text: `User ID: ${targetUser.id}` });

            // Add fields for each punishment type (show up to 5 most recent)
            if (groupedPunishments.warning.length > 0) {
                const warningList = groupedPunishments.warning.slice(0, 5).map(p => {
                    const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
                    const staff = p.staffMemberTag ? ` by ${p.staffMemberTag}` : '';
                    return `\`${p.caseId || 'N/A'}\` - ${date}${staff}${p.reason ? `\n   └ ${p.reason.substring(0, 40)}${p.reason.length > 40 ? '...' : ''}` : ''}`;
                }).join('\n');
                const moreText = groupedPunishments.warning.length > 5 ? `\n*...and ${groupedPunishments.warning.length - 5} more*` : '';
                embed.addFields({
                    name: `⚠️ Warnings (${groupedPunishments.warning.length})`,
                    value: warningList + moreText || 'None',
                    inline: false
                });
            }

            if (groupedPunishments.timeout.length > 0) {
                const timeoutList = groupedPunishments.timeout.slice(0, 5).map(p => {
                    const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
                    const duration = p.duration ? formatDuration(p.duration) : 'N/A';
                    const staff = p.staffMemberTag ? ` by ${p.staffMemberTag}` : '';
                    return `\`${p.caseId || 'N/A'}\` - ${date} - ${duration}${staff}${p.reason ? `\n   └ ${p.reason.substring(0, 35)}${p.reason.length > 35 ? '...' : ''}` : ''}`;
                }).join('\n');
                const moreText = groupedPunishments.timeout.length > 5 ? `\n*...and ${groupedPunishments.timeout.length - 5} more*` : '';
                embed.addFields({
                    name: `🔇 Timeouts (${groupedPunishments.timeout.length})`,
                    value: timeoutList + moreText || 'None',
                    inline: false
                });
            }

            if (groupedPunishments.blacklist.length > 0) {
                const blacklistList = groupedPunishments.blacklist.slice(0, 5).map(p => {
                    const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
                    const staff = p.staffMemberTag ? ` by ${p.staffMemberTag}` : '';
                    return `\`${p.caseId || 'N/A'}\` - ${date}${staff}${p.reason ? `\n   └ ${p.reason.substring(0, 40)}${p.reason.length > 40 ? '...' : ''}` : ''}`;
                }).join('\n');
                const moreText = groupedPunishments.blacklist.length > 5 ? `\n*...and ${groupedPunishments.blacklist.length - 5} more*` : '';
                embed.addFields({
                    name: `🚫 Blacklists (${groupedPunishments.blacklist.length})`,
                    value: blacklistList + moreText || 'None',
                    inline: false
                });
            }

            if (groupedPunishments.global_ban.length > 0) {
                const globalBanList = groupedPunishments.global_ban.slice(0, 5).map(p => {
                    const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
                    const staff = p.staffMemberTag ? ` by ${p.staffMemberTag}` : '';
                    return `\`${p.caseId || 'N/A'}\` - ${date}${staff}${p.reason ? `\n   └ ${p.reason.substring(0, 40)}${p.reason.length > 40 ? '...' : ''}` : ''}`;
                }).join('\n');
                const moreText = groupedPunishments.global_ban.length > 5 ? `\n*...and ${groupedPunishments.global_ban.length - 5} more*` : '';
                embed.addFields({
                    name: `🌐 Global Bans (${groupedPunishments.global_ban.length})`,
                    value: globalBanList + moreText || 'None',
                    inline: false
                });
            }

            if (groupedPunishments.global_rolestripe.length > 0) {
                const rolestripeList = groupedPunishments.global_rolestripe.slice(0, 5).map(p => {
                    const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
                    const staff = p.staffMemberTag ? ` by ${p.staffMemberTag}` : '';
                    return `\`${p.caseId || 'N/A'}\` - ${date}${staff}${p.reason ? `\n   └ ${p.reason.substring(0, 40)}${p.reason.length > 40 ? '...' : ''}` : ''}`;
                }).join('\n');
                const moreText = groupedPunishments.global_rolestripe.length > 5 ? `\n*...and ${groupedPunishments.global_rolestripe.length - 5} more*` : '';
                embed.addFields({
                    name: `🔪 Role Strips (${groupedPunishments.global_rolestripe.length})`,
                    value: rolestripeList + moreText || 'None',
                    inline: false
                });
            }

            // Add footer with note
            embed.setFooter({ text: `User ID: ${targetUser.id} • Punishments auto-clear after 14 days` });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Error looking up punishments:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to look up punishments: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

