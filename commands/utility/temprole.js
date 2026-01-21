const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasRolePermsPermission, getLogChannel } = require('../../utils/role-perms-config');
const { addTempRole, removeTempRole, getTempRole, getAllTempRoles } = require('../../utils/temp-role-database');

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

function formatTimeRemaining(expiresAt) {
    const now = Date.now();
    const remaining = expiresAt - now;
    
    if (remaining <= 0) return 'Expired';
    
    return formatDuration(remaining);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('temprole')
        .setDescription('Manage temporary roles for users')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to manage the temp role for')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to manage')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' },
                    { name: 'Status', value: 'status' }
                ))
        .addStringOption(option =>
            option.setName('time')
                .setDescription('Duration (e.g., 1h, 30m, 1d) - Required for add action')
                .setRequired(false)),
    
    async execute(interaction, client, config) {
        // Check permissions - use per-guild role perms config
        if (!hasRolePermsPermission(interaction.member, interaction.guild.id)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command. This server must be configured with `/setuproleperms`.')
                .setColor('#FF0000');
            
            return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }

        const targetUser = interaction.options.getUser('user');
        const role = interaction.options.getRole('role');
        const action = interaction.options.getString('action');
        const timeStr = interaction.options.getString('time');
        const guild = interaction.guild;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const targetMember = await guild.members.fetch(targetUser.id);

            // Permission hierarchy check
            if (role.position >= interaction.member.roles.highest.position && interaction.member.id !== guild.ownerId) {
                const errorEmbed = new EmbedBuilder()
                    .setDescription('❌ You cannot manage a role equal or higher than your highest role.')
                    .setColor('#FF0000');
                
                return interaction.editReply({ embeds: [errorEmbed] });
            }

            if (action === 'add') {
                if (!timeStr) {
                    const errorEmbed = new EmbedBuilder()
                        .setDescription('❌ Time duration is required for the add action. Use format like: 1h, 30m, 1d')
                        .setColor('#FF0000');
                    
                    return interaction.editReply({ embeds: [errorEmbed] });
                }

                const duration = parseDuration(timeStr);
                if (!duration) {
                    const errorEmbed = new EmbedBuilder()
                        .setDescription('❌ Invalid duration format. Use formats like: 1h, 30m, 1d, etc.')
                        .setColor('#FF0000');
                    
                    return interaction.editReply({ embeds: [errorEmbed] });
                }

                const expiresAt = Date.now() + duration;

                // Add role to user
                if (!targetMember.roles.cache.has(role.id)) {
                    await targetMember.roles.add(role, `Temporary role added by ${interaction.user.tag}`);
                }

                // Store temp role in database
                addTempRole(guild.id, targetUser.id, role.id, expiresAt);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Temporary Role Added')
                    .setDescription(`Successfully added temporary role ${role} to ${targetUser.tag}.`)
                    .addFields(
                        { name: 'User', value: `${targetUser}`, inline: true },
                        { name: 'Role', value: `${role}`, inline: true },
                        { name: 'Duration', value: formatDuration(duration), inline: true },
                        { name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:R>`, inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                // Log to server-specific log channel
                const logChannelId = getLogChannel(interaction.guild.id);
                if (logChannelId) {
                    client.channels.fetch(logChannelId).then(logChannel => {
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('⏰ Temporary Role Added')
                                .addFields(
                                    { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: false },
                                    { name: 'Role', value: `${role} (${role.id})`, inline: false },
                                    { name: 'Duration', value: formatDuration(duration), inline: true },
                                    { name: 'Expires', value: `<t:${Math.floor(expiresAt / 1000)}:F>`, inline: true },
                                    { name: 'Added By', value: `${interaction.user} (${interaction.user.id})`, inline: false }
                                )
                                .setColor('#00CED1')
                                .setTimestamp();

                            return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    }).catch(() => {});
                }

            } else if (action === 'remove') {
                // Remove role from user
                if (targetMember.roles.cache.has(role.id)) {
                    await targetMember.roles.remove(role, `Temporary role removed by ${interaction.user.tag}`);
                }

                // Remove from database
                const removed = removeTempRole(guild.id, targetUser.id, role.id);

                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Temporary Role Removed')
                    .setDescription(`Successfully removed temporary role ${role} from ${targetUser.tag}.`)
                    .addFields(
                        { name: 'User', value: `${targetUser}`, inline: true },
                        { name: 'Role', value: `${role}`, inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();

                await interaction.editReply({ embeds: [successEmbed] });

                // Log to server-specific log channel
                const logChannelId = getLogChannel(interaction.guild.id);
                if (logChannelId) {
                    client.channels.fetch(logChannelId).then(logChannel => {
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('⏰ Temporary Role Removed')
                                .addFields(
                                    { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: false },
                                    { name: 'Role', value: `${role} (${role.id})`, inline: false },
                                    { name: 'Removed By', value: `${interaction.user} (${interaction.user.id})`, inline: false }
                                )
                                .setColor('#FFA500')
                                .setTimestamp();

                            return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    }).catch(() => {});
                }

            } else if (action === 'status') {
                const tempRole = getTempRole(guild.id, targetUser.id, role.id);

                if (!tempRole) {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('❌ No Temporary Role Found')
                        .setDescription(`No temporary role record found for ${targetUser.tag} with role ${role}.`)
                        .setColor('#FF0000');
                    
                    return interaction.editReply({ embeds: [errorEmbed] });
                }

                const timeRemaining = formatTimeRemaining(tempRole.expiresAt);
                const isExpired = tempRole.expiresAt <= Date.now();
                const hasRole = targetMember.roles.cache.has(role.id);

                const statusEmbed = new EmbedBuilder()
                    .setTitle('⏰ Temporary Role Status')
                    .setDescription(`Status for ${targetUser.tag}'s temporary role ${role}`)
                    .addFields(
                        { name: 'User', value: `${targetUser}`, inline: true },
                        { name: 'Role', value: `${role}`, inline: true },
                        { name: 'Time Remaining', value: timeRemaining, inline: true },
                        { name: 'Role Active', value: hasRole ? 'Yes' : 'No', inline: true },
                        { name: 'Status', value: isExpired ? '⚠️ Expired' : '✅ Active', inline: true },
                        { name: 'Expires At', value: `<t:${Math.floor(tempRole.expiresAt / 1000)}:F>`, inline: false }
                    )
                    .setColor(isExpired ? '#FF0000' : '#00FF00')
                    .setTimestamp();

                await interaction.editReply({ embeds: [statusEmbed] });
            }

        } catch (error) {
            console.error('Error managing temp role:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to manage temporary role: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
};

