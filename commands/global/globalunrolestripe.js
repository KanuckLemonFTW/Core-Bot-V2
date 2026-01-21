const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getUserRoles } = require('../../utils/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalunrolestripe')
        .setDescription('Globally restore roles to a user across all servers')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to restore roles for')
                .setRequired(true)),
    async execute(interaction, client, config) {
        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;

        // Check permissions
        if (!hasPermission(member, config.permissions.rolePerms)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Check role hierarchy in the current guild
        const guild = interaction.guild;
        try {
            const targetMember = await guild.members.fetch(targetUser.id);
            // Check role hierarchy - cannot restore roles for users with equal or higher roles
            if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
                const errorEmbed = new EmbedBuilder()
                    .setDescription('You cannot restore roles for users with equal or higher roles than your highest role.')
                    .setColor('#FF0000');
                
                return interaction.reply({
                    embeds: [errorEmbed],
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (error) {
            // User might not be in the current server, which is fine for global commands
            // Continue with the command
        }

        // Defer reply immediately to prevent timeout during long operation
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Restore roles only in the current server (where command was used)
        const currentGuild = interaction.guild;
        let totalRolesRestored = 0;
        let roleMentions = [];
        let restoreSuccess = false;
        let restoreError = null;

        try {
            const savedRoles = getUserRoles(currentGuild.id, targetUser.id);
            
            if (!savedRoles || savedRoles.length === 0) {
                // No roles to restore
            } else {
                const guildMember = await currentGuild.members.fetch(targetUser.id).catch(() => null);
                if (!guildMember) {
                    restoreError = 'User is not in this server.';
                } else {
                    // Filter out roles that no longer exist and get role mentions
                    const rolesToRestore = [];
                    for (const roleId of savedRoles) {
                        const role = await currentGuild.roles.fetch(roleId).catch(() => null);
                        if (role) {
                            rolesToRestore.push(role);
                            roleMentions.push(`${role}`);
                        }
                    }

                    if (rolesToRestore.length > 0) {
                        await guildMember.roles.add(rolesToRestore, `Role restore by ${member.user.tag}`);
                        totalRolesRestored = rolesToRestore.length;
                        restoreSuccess = true;
                    }
                }
            }
        } catch (error) {
            restoreError = error.message;
        }

        // Log to role strip logs channel only
        if (config.settings.logAllActions && config.channels.globalRolestripeLogs && restoreSuccess) {
            const roleStripLogChannel = await client.channels.fetch(config.channels.globalRolestripeLogs).catch(() => null);
            if (roleStripLogChannel) {
                const logFields = [
                    { name: 'Staff Member', value: `${member.user}`, inline: false },
                    { name: 'User Restored', value: `${targetUser}`, inline: false },
                    { name: 'Server', value: `${currentGuild.name}`, inline: true },
                    { name: 'Total Roles', value: `${totalRolesRestored}`, inline: true }
                ];
                
                // Add role list if available
                if (roleMentions.length > 0) {
                    const roleList = roleMentions.join(' ');
                    logFields.push({
                        name: 'Roles Restored',
                        value: roleList.length > 1024 ? roleList.substring(0, 1020) + '...' : roleList,
                        inline: false
                    });
                }
                
                const logEmbed = new EmbedBuilder()
                    .setTitle('Global Role Restore Executed')
                    .addFields(logFields)
                    .setColor('#0099FF')
                    .setTimestamp();
                
                await roleStripLogChannel.send({ embeds: [logEmbed] });
            }
        }
        
        if (!restoreSuccess) {
            const noRolesEmbed = new EmbedBuilder()
                .setTitle('⚠️ No Roles to Restore')
                .setDescription(restoreError || `There are no valid roles to restore for ${targetUser} in this server.`)
                .setColor('#FF9900')
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [noRolesEmbed]
            });
        } else {
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Role Restore Completed')
                .setDescription(`Roles have been restored to ${targetUser} in ${currentGuild.name}.`)
                .addFields(
                    { name: 'User', value: `${targetUser}`, inline: true },
                    { name: 'Server', value: `${currentGuild.name}`, inline: true },
                    { name: 'Total Roles Restored', value: `${totalRolesRestored}`, inline: true }
                )
                .setColor('#0099FF')
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [successEmbed]
            });
        }
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}
