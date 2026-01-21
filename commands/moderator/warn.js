const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasModerationPermission, getLogChannel } = require('../../utils/moderation-config');
const { addCase } = require('../../utils/case-database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(false)),
    async execute(interaction, client, config) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
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

        // Check if target user is in the server and role hierarchy
        try {
            const targetMember = await guild.members.fetch(targetUser.id);
            // Check role hierarchy - cannot warn users with equal or higher roles
            if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Permission Denied')
                    .setDescription('You cannot warn users with equal or higher roles than your highest role.')
                    .setColor('#FF0000')
                    .setTimestamp();

                return interaction.editReply({
                    embeds: [errorEmbed]
                });
            }
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
            // Generate case ID
            const caseId = addCase(interaction.guild.id, {
                userId: targetUser.id,
                userTag: targetUser.tag,
                punishmentType: 'warning',
                staffMemberId: interaction.user.id,
                staffMemberTag: interaction.user.tag,
                reason: reason
            });

            // Update UI immediately
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ User Warned')
                .setDescription(`Successfully warned ${targetUser.tag}.`)
                .addFields(
                    { name: 'User', value: `${targetUser}`, inline: true },
                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                    { name: 'Reason', value: reason, inline: false }
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
                            .setTitle('You have been warned')
                            .setDescription(`You have been warned in **${guild.name}**`)
                            .addFields(
                                { name: 'Reason', value: reason }
                            )
                            .setColor('#FFA500')
                            .setTimestamp();
                        
                        return targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
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
                                .setTitle('User Warned')
                                .addFields(
                                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                                    { name: 'Staff Member', value: `${member.user} (${member.user.id})`, inline: true },
                                    { name: 'User', value: `${targetUser} (${targetUser.id})`, inline: true },
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
            console.error('Error warning user:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to warn user: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [errorEmbed]
            });
        }
    }
};


