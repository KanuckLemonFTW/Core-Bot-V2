const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalunban')
        .setDescription('Globally unban a user from all servers')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to globally unban (optional if case number provided)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the global unban')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('casenumber')
                .setDescription('Case number from the original ban (optional)')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const crowCode = 'crow'; // hidden identifier
        const caseNumber = interaction.options.getString('casenumber');
        let targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.member;
        
        // If case number is provided, try to find the user from the case
        if (caseNumber && !targetUser) {
            const { getCaseByCaseId } = require('../../utils/case-database');
            const caseData = getCaseByCaseId(interaction.guild.id, caseNumber);
            if (caseData && caseData.userId) {
                try {
                    targetUser = await client.users.fetch(caseData.userId);
                } catch (error) {
                    const errorEmbed = new EmbedBuilder()
                        .setDescription(`❌ Case number found but could not fetch user. Please provide a user instead.`)
                        .setColor('#FF0000');
                    
                    return interaction.reply({ 
                        embeds: [errorEmbed],
                        flags: MessageFlags.Ephemeral
                    });
                }
            } else {
                const errorEmbed = new EmbedBuilder()
                    .setDescription(`❌ Case number not found. Please provide a valid case number or user.`)
                    .setColor('#FF0000');
                
                return interaction.reply({ 
                    embeds: [errorEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }
        }
        
        // User is required
        if (!targetUser) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ Please provide either a user or a case number.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Check permissions
        if (!hasPermission(member, config.permissions.globalBan)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Check if ban is escalated
        let isEscalated = false;
        if (config.channels.globalBanLogs) {
            try {
                const logChannel = await client.channels.fetch(config.channels.globalBanLogs).catch(() => null);
                if (logChannel) {
                    const messages = await logChannel.messages.fetch({ limit: 100 });
                    for (const message of messages.values()) {
                        if (message.embeds.length > 0) {
                            const embed = message.embeds[0];
                            const userBannedField = embed.fields?.find(f => f.name === 'User Id');
                            if (userBannedField && userBannedField.value === `\`${targetUser.id}\``) {
                                if (message.components && message.components.length > 0) {
                                    for (const row of message.components) {
                                        for (const button of row.components) {
                                            if (button.customId && button.customId.startsWith('gban_escalate_')) {
                                                if (button.disabled && button.label && button.label.includes('Escalated by')) {
                                                    isEscalated = true;
                                                    break;
                                                }
                                            }
                                        }
                                        if (isEscalated) break;
                                    }
                                }
                                if (isEscalated) break;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error checking escalation status:', error);
            }
        }

        // If escalated, check ownership permission
        if (isEscalated) {
            if (!hasPermission(member, config.permissions.ownership)) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Cannot Unban Escalated Ban')
                    .setDescription('You cannot use `/globalunban` on this person since it has been escalated by ownership.')
                    .setColor('#FF0000')
                    .setTimestamp();
                
                return interaction.reply({ 
                    embeds: [errorEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Global Unban')
            .setDescription(`Are you sure you want to globally unban **${targetUser.tag}** (${targetUser.id})?\n\nThis will unban them from **ALL** servers where this bot is present.`)
            .addFields(
                { name: 'User', value: `${targetUser}`, inline: true },
                { name: 'User ID', value: targetUser.id, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setColor('#0099FF')
            .setTimestamp();
        
        if (caseNumber) {
            confirmEmbed.addFields({ name: 'Case Number', value: `\`${caseNumber}\``, inline: true });
        }

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`globalunban_confirm_${targetUser.id}`)
                    .setLabel('Confirm')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`globalunban_cancel_${targetUser.id}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.reply({
            embeds: [confirmEmbed],
            components: [confirmRow],
            flags: MessageFlags.Ephemeral
        });
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}
