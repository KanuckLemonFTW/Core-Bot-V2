const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUserRoles } = require('../../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apirestore')
        .setDescription('Restore roles for a previously kicked/banned user')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to restore roles for')
                .setRequired(true)
        ),

    async execute(interaction, client, config) {
        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;
        const guild = interaction.guild;

        const crowDev = 'crow'; // ownership verification
        // Defer immediately for instant response
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
        // Check permissions (ownership)
        if (!hasPermission(member, config.permissions.ownership)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            return interaction.editReply({ 
                embeds: [errorEmbed]
            });
        }

        // Get saved roles from database
        const savedRoles = getUserRoles(guild.id, targetUser.id);
        
        if (!savedRoles || savedRoles.length === 0) {
            const errorEmbed = new EmbedBuilder()
                .setDescription(`❌ No role backup found for **${targetUser.tag}**. Backups expire after 24 hours.`)
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.editReply({
                embeds: [errorEmbed]
            });
        }

        try {
            // Get the member
            const guildMember = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!guildMember) {
                return interaction.editReply({
                    content: 'User is not in this server.'
                });
            }
            
            // Filter roles that still exist (in parallel)
            const roleFetchPromises = savedRoles.map(roleId => 
                guild.roles.fetch(roleId).catch(() => null)
            );
            const fetchedRoles = await Promise.all(roleFetchPromises);
            
            const validRoles = fetchedRoles.filter(r => r !== null);
            const invalidRoles = savedRoles.filter((roleId, index) => fetchedRoles[index] === null);

            if (validRoles.length === 0) {
                const errorEmbed = new EmbedBuilder()
                    .setDescription('There are no valid roles to restore for this user.')
                    .setColor('#FF0000')
                    .setTimestamp();
                
                return interaction.editReply({
                    embeds: [errorEmbed]
                });
            }

            // Add roles back
            await guildMember.roles.add(validRoles, `Roles restored by ${interaction.user.tag}`);

            // Create success embed
            const successEmbed = new EmbedBuilder()
                .setColor('#51CF66')
                .setTitle('✅ Roles Restored')
                .setDescription(`Successfully restored roles for **${targetUser.tag}**`)
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: 'Roles Restored', value: `${validRoles.length}`, inline: true },
                    { name: 'Restored By', value: `${interaction.user.tag}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Role Restore System' });

            if (validRoles.length > 0) {
                successEmbed.addFields({
                    name: 'Restored Roles',
                    value: validRoles.map(r => `<@&${r.id}>`).join(', ')
                });
            }

            if (invalidRoles.length > 0) {
                successEmbed.addFields({
                    name: '⚠️ Roles Not Found',
                    value: `${invalidRoles.length} role(s) no longer exist in the server`
                });
            }

            await interaction.editReply({ embeds: [successEmbed] });

            // Send log to restore logs channel asynchronously (non-blocking)
            if (config.settings.logAllActions && config.channels.restoreLogs) {
                client.channels.fetch(config.channels.restoreLogs).then(logChannel => {
                    if (logChannel) {
                        return logChannel.send({ embeds: [successEmbed] }).catch(() => {});
                    }
                }).catch(() => {});
            }

        } catch (error) {
            console.error('Error restoring roles:', error);
            await interaction.editReply({
                content: `❌ An error occurred while restoring roles: ${error.message}`
            });
        }
    },
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}
