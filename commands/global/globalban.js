const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalban')
        .setDescription('Globally ban a user from all servers')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to globally ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the global ban')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const crowOwner = 'crow'; // ownership marker
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.member;
        const guild = interaction.guild;

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

        // Prevent self-targeting
        if (targetUser.id === interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You cannot globally ban yourself.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Check if target user is in the server and role hierarchy
        try {
            const targetMember = await guild.members.fetch(targetUser.id);
            // Check role hierarchy - cannot ban users with equal or higher roles
            if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('You cannot globally ban users with equal or higher roles than your highest role.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
            }
        } catch (error) {
            // User might not be in the server, which is fine for global ban
            // Continue with the command
        }

        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Global Ban')
            .setDescription(`Are you sure you want to globally ban **${targetUser.tag}** (${targetUser.id})?\n\nThis will ban them from **ALL** servers where this bot is present.`)
            .addFields(
                { name: 'User', value: `${targetUser}`, inline: true },
                { name: 'User ID', value: targetUser.id, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setColor('#FF9900')
            .setTimestamp();

        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`globalban_confirm_${targetUser.id}`)
                    .setLabel('Confirm')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`globalban_cancel_${targetUser.id}`)
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

