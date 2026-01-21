const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forceverify')
        .setDescription('Force verify a user (remove unverified role, add verified role)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to force verify')
                .setRequired(true)),
    async execute(interaction, client, config) {
        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;
        const guild = interaction.guild;

        // Check permissions
        if (!hasPermission(member, config.permissions.forceverify)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        if (!config.roles.unverified || !config.roles.verified) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Configuration Error')
                .setDescription('Unverified or verified role not configured. Please set them in config.json')
                .setColor('#FF0000')
                .setTimestamp();

            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Defer the reply to allow time for processing
        await interaction.deferReply();

        try {
            // Fetch member and roles in parallel
            const [guildMember, unverifiedRole, verifiedRole] = await Promise.all([
                guild.members.fetch(targetUser.id),
                guild.roles.fetch(config.roles.unverified).catch(() => null),
                guild.roles.fetch(config.roles.verified).catch(() => null)
            ]);

            if (!unverifiedRole || !verifiedRole) {
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Role Not Found')
                    .setDescription('Unverified or verified role not found in this server.')
                    .setColor('#FF0000')
                    .setTimestamp();

                return interaction.editReply({
                    embeds: [errorEmbed]
                });
            }

            // Remove unverified role and add verified role in parallel
            const rolePromises = [];
            if (guildMember.roles.cache.has(unverifiedRole.id)) {
                rolePromises.push(guildMember.roles.remove(unverifiedRole, `Force verified by ${member.user.tag}`));
            }
            rolePromises.push(guildMember.roles.add(verifiedRole, `Force verified by ${member.user.tag}`));
            await Promise.all(rolePromises);

            // Update UI immediately
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ User Force Verified')
                .setDescription(`Successfully force verified ${targetUser.tag}.`)
                .addFields(
                    { name: 'User', value: `${targetUser}`, inline: true },
                    { name: 'Unverified Role Removed', value: unverifiedRole.name, inline: true },
                    { name: 'Verified Role Added', value: verifiedRole.name, inline: true }
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
                            .setTitle('You have been verified')
                            .setDescription(`You have been force verified in **${guild.name}**.\n\n**Verified by:** ${member.user.tag}`)
                            .setColor('#00FF00')
                            .setTimestamp();
                        
                        return targetUser.send({ embeds: [dmEmbed] }).catch(error => {
                            if (error.code !== 50007) {
                                console.error('Could not send DM to force verified user:', error.message);
                            }
                        });
                    })
                );
            }

            if (config.settings.logAllActions && config.channels.verifyLogs) {
                promises.push(
                    client.channels.fetch(config.channels.verifyLogs).then(logChannel => {
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('User Force Verified')
                                .addFields(
                                    { name: 'Staff Member', value: `${member.user}`, inline: true },
                                    { name: 'User', value: `${targetUser}`, inline: true },
                                    { name: 'Unverified Role Removed', value: unverifiedRole.name, inline: true },
                                    { name: 'Verified Role Added', value: verifiedRole.name, inline: true }
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
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Error')
                .setDescription(`Failed to force verify user: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [errorEmbed]
            });
        }
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

