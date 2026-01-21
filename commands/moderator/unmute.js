const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasModerationPermission, getLogChannel } = require('../../utils/moderation-config');
const { addCase } = require('../../utils/case-database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to unmute')
                .setRequired(true)),
    async execute(interaction, client, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;
        const guild = interaction.guild;

        // Check permissions - use per-guild moderation config
        if (!hasModerationPermission(member, interaction.guild.id)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command. This server must be configured with `/setupmoderation`.')
                .setColor('#FF0000');
            
            return interaction.editReply({ 
                embeds: [errorEmbed]
            });
        }

        // Check if target user is in the server
        let targetMember;
        try {
            targetMember = await guild.members.fetch(targetUser.id);
        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ User Not Found')
                .setDescription('User is not in this server.')
                .setColor('#FF0000')
                .setTimestamp();

            return interaction.editReply({
                embeds: [errorEmbed]
            });
        }

        try {
            // Check if user is actually timed out
            if (!targetMember.communicationDisabledUntil || targetMember.communicationDisabledUntil < new Date()) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Not Timed Out')
                    .setDescription('User is not currently timed out.')
                    .setColor('#FF0000')
                    .setTimestamp();

                return interaction.editReply({
                    embeds: [errorEmbed]
                });
            }

            // Generate case ID
            const caseId = addCase(interaction.guild.id, {
                userId: targetUser.id,
                userTag: targetUser.tag,
                punishmentType: 'unmute',
                staffMemberId: interaction.user.id,
                staffMemberTag: interaction.user.tag,
                reason: 'Timeout removed'
            });

            // Remove timeout
            await targetMember.timeout(null, `Timeout removed by ${member.user.tag}`);

            // Update UI immediately
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Timeout Removed')
                .setDescription(`Successfully removed timeout from ${targetUser.tag}.`)
                .addFields(
                    { name: 'User', value: `${targetUser}`, inline: true },
                    { name: 'Case ID', value: `\`${caseId}\``, inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();

            await interaction.editReply({
                embeds: [successEmbed]
            });

            // Send DM and log asynchronously (non-blocking)
            const promises = [];
            
            if (config.settings.sendDMs) {
                promises.push(
                    Promise.resolve().then(() => {
                        const dmEmbed = new EmbedBuilder()
                            .setTitle('Your timeout has been removed')
                            .setDescription(`Your timeout has been removed in **${guild.name}**.\n\n**Unmuted by:** ${member.user.tag}`)
                            .setColor('#00FF00')
                            .setTimestamp();
                        
                        return targetUser.send({ embeds: [dmEmbed] }).catch(error => {
                            if (error.code !== 50007) {
                                console.error('Could not send DM to unmuted user:', error.message);
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
                                .setTitle('User Timeout Removed')
                                .addFields(
                                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                                    { name: 'Staff Member', value: `${member.user} (${member.user.id})`, inline: true },
                                    { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: true }
                                )
                                .setColor('#00FF00')
                                .setTimestamp();

                            return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                        }
                    }).catch(() => {})
                );
            }

            Promise.all(promises).catch(() => {});
        } catch (error) {
            console.error('Error removing timeout:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to remove timeout: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [errorEmbed]
            });
        }
    }
};


