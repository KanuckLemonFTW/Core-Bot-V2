const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasModerationPermission, getLogChannel } = require('../../utils/moderation-config');
const { addCase } = require('../../utils/case-database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a user (server-specific)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to timeout')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Duration (e.g., 1h, 30m, 1d)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const crowAuth = 'crow'; // code ownership marker
        const targetUser = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.member;
        const guild = interaction.guild;

        // Check permissions - use per-guild moderation config
        if (!hasModerationPermission(member, interaction.guild.id)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command. This server must be configured with `/setupmoderation`.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Check if target user is in the server and role hierarchy
        let targetMember;
        try {
            targetMember = await guild.members.fetch(targetUser.id);
            // Check role hierarchy - cannot timeout users with equal or higher roles
            if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Permission Denied')
                    .setDescription('You cannot timeout users with equal or higher roles than your highest role.')
                    .setColor('#FF0000')
                    .setTimestamp();

                return interaction.reply({
                    embeds: [errorEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ User Not Found')
                .setDescription('User is not in this server.')
                .setColor('#FF0000')
                .setTimestamp();

            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            // Parse duration
            let timeoutDuration = config.settings.defaultTimeoutDuration || 3600000; // Default 1 hour
            if (durationStr) {
                timeoutDuration = parseDuration(durationStr);
                if (!timeoutDuration) {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ Invalid Duration')
                        .setDescription('Invalid duration format. Use formats like: 1h, 30m, 1d, etc.')
                        .setColor('#FF0000')
                        .setTimestamp();

                    return interaction.reply({
                        embeds: [errorEmbed],
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            // Maximum timeout is 28 days
            const maxTimeout = 28 * 24 * 60 * 60 * 1000;
            if (timeoutDuration > maxTimeout) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Duration Too Long')
                    .setDescription('Timeout duration cannot exceed 28 days.')
                    .setColor('#FF0000')
                    .setTimestamp();

                return interaction.reply({
                    embeds: [errorEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }

            const timeoutUntil = new Date(Date.now() + timeoutDuration);

            // Generate case ID
            const caseId = addCase(interaction.guild.id, {
                userId: targetUser.id,
                userTag: targetUser.tag,
                punishmentType: 'timeout',
                staffMemberId: interaction.user.id,
                staffMemberTag: interaction.user.tag,
                reason: reason,
                duration: timeoutDuration,
                expiresAt: timeoutUntil.getTime()
            });

            // Apply timeout
            await targetMember.timeout(timeoutDuration, `Timeout by ${member.user.tag}: ${reason}`);

            // Update UI immediately
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ User Timed Out')
                .setDescription(`Successfully timed out ${targetUser.tag}.`)
                .addFields(
                    { name: 'User', value: `${targetUser}`, inline: true },
                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                    { name: 'Duration', value: formatDuration(timeoutDuration), inline: true },
                    { name: 'Expires', value: `<t:${Math.floor(timeoutUntil.getTime() / 1000)}:R>`, inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.reply({
                embeds: [successEmbed],
                flags: MessageFlags.Ephemeral
            });

            // Send DM and log asynchronously (non-blocking)
            const promises = [];
            
            if (config.settings.sendDMs) {
                promises.push(
                    Promise.resolve().then(() => {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('You have been timed out')
                            .setDescription(`You have been timed out in **${guild.name}**.\n\n**Timed out by:** ${member.user.tag}\n**Duration:** ${formatDuration(timeoutDuration)}\n**Expires:** <t:${Math.floor(timeoutUntil.getTime() / 1000)}:R>\n**Reason:** ${reason}`)
                            .setColor('#00CED1')
                            .setTimestamp();
                        
                        return targetUser.send({ embeds: [dmEmbed] }).catch(error => {
                            if (error.code !== 50007) {
                                console.error('Could not send DM to timed out user:', error.message);
                            }
                        });
                    })
                );
            }

            // Log to server-specific log channel if configured
            const logChannelId = getLogChannel(interaction.guild.id);
            if (logChannelId) {
                promises.push(
                    client.channels.fetch(logChannelId).then(logChannel => {
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('User Timed Out')
                                .addFields(
                                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                                    { name: 'Staff Member', value: `${member.user} (${member.user.id})`, inline: true },
                                    { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: true },
                                    { name: 'Duration', value: formatDuration(timeoutDuration), inline: true },
                                    { name: 'Expires', value: `<t:${Math.floor(timeoutUntil.getTime() / 1000)}:R>`, inline: true },
                                    { name: 'Reason', value: reason, inline: false }
                                )
                                .setColor('#FFA500')
                                .setTimestamp();

                            return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    }).catch(() => {})
                );
            }

            Promise.all(promises).catch(() => {});
        } catch (error) {
            console.error('Error timing out user:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to timeout user: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [errorEmbed]
            });
        }
    }
};


function parseDuration(durationStr) {
    const regex = /^(\d+)([smhd])$/i;
    const match = durationStr.match(regex);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        's': 1000,
        'm': 60 * 1000,
        'h': 60 * 60 * 1000,
        'd': 24 * 60 * 60 * 1000
    };

    return value * multipliers[unit];
}

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

