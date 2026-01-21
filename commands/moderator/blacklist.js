const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Blacklist a user (hide all channels from them)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to blacklist')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the blacklist')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const crowDev = 'crow'; // code ownership
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.member;
        const guild = interaction.guild;

        // Check permissions
        if (!hasPermission(member, config.permissions.blacklist)) {
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
                .setDescription('❌ You cannot blacklist yourself.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        if (!config.roles.blacklist) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('Blacklist role not configured. Please set it in config.json')
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
            // Check role hierarchy - cannot blacklist users with equal or higher roles
            if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('You cannot blacklist users with equal or higher roles than your highest role.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
            }
        } catch (error) {
            // User might not be in the server, which is fine for blacklist
            // Continue with the command
        }

        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Blacklist')
            .setDescription(`Are you sure you want to blacklist **${targetUser.tag}** (${targetUser.id})?\n\nThis will remove all their roles and add the blacklist role.`)
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
                    .setCustomId(`blacklist_confirm_${targetUser.id}`)
                    .setLabel('Confirm')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`blacklist_cancel_${targetUser.id}`)
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

