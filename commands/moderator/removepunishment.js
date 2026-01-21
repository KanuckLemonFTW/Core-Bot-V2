const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removepunishment')
        .setDescription('Remove a punishment case from a user\'s record')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remove a punishment from')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('caseid')
                .setDescription('The case ID of the punishment to remove')
                .setRequired(true)),
    async execute(interaction, client, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Check permissions
        if (!hasPermission(interaction.member, config.permissions.removePunishment)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            return interaction.editReply({ embeds: [errorEmbed] });
        }

        const targetUser = interaction.options.getUser('user');
        const caseId = interaction.options.getString('caseid').trim().replace(/`/g, '');
        const CASE_DB_FILE = path.join(__dirname, '../../data/case_database.json');

        if (!fs.existsSync(CASE_DB_FILE)) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription('Case database not found.')
                .setColor('#FF0000');
            
            return interaction.editReply({ embeds: [errorEmbed] });
        }

        try {
            const db = JSON.parse(fs.readFileSync(CASE_DB_FILE, 'utf8'));
            let found = false;
            let removedCase = null;
            let guildId = null;

            // Search all guilds for the case
            for (const gId in db) {
                if (db[gId] && Array.isArray(db[gId])) {
                    const caseIndex = db[gId].findIndex(c => c.caseId === caseId && c.userId === targetUser.id);
                    if (caseIndex !== -1) {
                        removedCase = db[gId][caseIndex];
                        db[gId].splice(caseIndex, 1);
                        guildId = gId;
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Case Not Found')
                    .setDescription(`No punishment case found with ID \`${caseId}\` for user ${targetUser.tag}.`)
                    .setColor('#FF0000');
                
                return interaction.editReply({ embeds: [errorEmbed] });
            }

            // Save the updated database
            fs.writeFileSync(CASE_DB_FILE, JSON.stringify(db, null, 2));

            // Success embed
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Punishment Removed')
                .setDescription(`Successfully removed punishment case \`${caseId}\` from ${targetUser.tag}'s record.`)
                .addFields(
                    { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: true },
                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                    { name: 'Punishment Type', value: removedCase.punishmentType || 'Unknown', inline: true },
                    { name: 'Removed By', value: `${interaction.user} (${interaction.user.id})`, inline: false }
                )
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            // Log the removal
            if (config.channels.punishmentRemovalLogs) {
                const logChannel = await client.channels.fetch(config.channels.punishmentRemovalLogs).catch(() => null);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('🗑️ Punishment Case Removed')
                        .setDescription('A punishment case has been removed from a user\'s record.')
                        .addFields(
                            { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: false },
                            { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                            { name: 'Punishment Type', value: removedCase.punishmentType || 'Unknown', inline: true },
                            { name: 'Removed By', value: `${interaction.user} (${interaction.user.id})`, inline: false },
                            { name: 'Original Reason', value: removedCase.reason || 'No reason provided', inline: false },
                            { name: 'Time', value: `${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })}`, inline: false }
                        )
                        .setColor('#FFA500')
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                }
            }
        } catch (error) {
            console.error('Error removing punishment:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to remove punishment: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};

