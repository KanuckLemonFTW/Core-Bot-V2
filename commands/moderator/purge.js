const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { hasModerationPermission, getLogChannel } = require('../../utils/moderation-config');
const { addCase } = require('../../utils/case-database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete a specified number of messages')
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Only delete messages from this user')
                .setRequired(false)),
    async execute(interaction, client, config) {
        // Defer reply if not already deferred/replied
        if (!interaction.deferred && !interaction.replied) {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Failed to defer reply:', error);
                // If defer fails, try to reply instead
                try {
                    return await interaction.reply({ 
                        content: 'Processing...', 
                        flags: MessageFlags.Ephemeral 
                    });
                } catch (e) {
                    console.error('Failed to reply:', e);
                    return; // If both fail, just return
                }
            }
        }

        const count = interaction.options.getInteger('count');
        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;
        const channel = interaction.channel;

        // Check permissions - use per-guild moderation config
        if (!hasModerationPermission(member, interaction.guild.id)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command. This server must be configured with `/setupmoderation`.')
                .setColor('#FF0000');
            
            return interaction.editReply({ 
                embeds: [errorEmbed]
            });
        }

        // Check bot permissions
        if (!channel.permissionsFor(client.user).has(PermissionFlagsBits.ManageMessages)) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Missing Permissions')
                .setDescription('I do not have permission to manage messages in this channel.')
                .setColor('#FF0000')
                .setTimestamp();

            return interaction.editReply({
                embeds: [errorEmbed]
            });
        }

        try {
            let deletedCount = 0;
            let messagesToDelete = [];

            if (targetUser) {
                // Fetch messages and filter by user
                const messages = await channel.messages.fetch({ limit: 100 });
                messagesToDelete = messages.filter(msg => msg.author.id === targetUser.id).first(count);
            } else {
                // Fetch messages normally
                const messages = await channel.messages.fetch({ limit: count });
                messagesToDelete = Array.from(messages.values());
            }

            if (messagesToDelete.length === 0) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ No Messages Found')
                    .setDescription('No messages found to delete.')
                    .setColor('#FF0000')
                    .setTimestamp();

                return interaction.editReply({
                    embeds: [errorEmbed]
                });
            }

            // Delete messages (bulk delete for messages older than 14 days, individual for newer)
            const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
            const oldMessages = messagesToDelete.filter(msg => msg.createdTimestamp < twoWeeksAgo);
            const newMessages = messagesToDelete.filter(msg => msg.createdTimestamp >= twoWeeksAgo);

            if (newMessages.length > 0) {
                await channel.bulkDelete(newMessages, true);
                deletedCount += newMessages.length;
            }

            // Delete old messages in parallel
            const deletePromises = oldMessages.map(msg => 
                msg.delete().then(() => ({ success: true })).catch(() => ({ success: false }))
            );
            const deleteResults = await Promise.allSettled(deletePromises);
            deletedCount += deleteResults.filter(r => r.status === 'fulfilled' && r.value.success).length;

            // Generate case ID
            const caseId = addCase(interaction.guild.id, {
                userId: targetUser ? targetUser.id : null,
                userTag: targetUser ? targetUser.tag : 'All users',
                punishmentType: 'purge',
                staffMemberId: interaction.user.id,
                staffMemberTag: interaction.user.tag,
                reason: `Purged ${deletedCount} message(s)`,
                messageCount: deletedCount
            });

            // Update UI immediately
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Messages Purged')
                .setDescription(`Successfully deleted ${deletedCount} message(s).`)
                .addFields(
                    { name: 'Case ID', value: `\`${caseId}\``, inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();

            if (targetUser) {
                successEmbed.addFields({ name: 'Target User', value: `${targetUser}`, inline: true });
            }

            await interaction.editReply({
                embeds: [successEmbed]
            });

            // Log to server-specific log channel if configured
            const logChannelId = getLogChannel(interaction.guild.id);
            if (logChannelId) {
                client.channels.fetch(logChannelId).then(logChannel => {
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('Messages Purged')
                            .addFields(
                                { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                                { name: 'Staff Member', value: `${member.user} (${member.user.id})`, inline: true },
                                { name: 'Channel', value: `${channel}`, inline: true },
                                { name: 'Messages Deleted', value: `${deletedCount}`, inline: true }
                            )
                            .setColor('#FFA500')
                            .setTimestamp();

                        if (targetUser) {
                            logEmbed.addFields({ name: 'Target User', value: `${targetUser} (${targetUser.id})`, inline: true });
                        }

                        return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Error purging messages:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to purge messages: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [errorEmbed]
            });
        }
    }
};


