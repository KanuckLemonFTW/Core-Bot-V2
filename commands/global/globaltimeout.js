const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globaltimeout')
        .setDescription('Globally timeout a user in all servers')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to timeout')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Duration in minutes')
                .setRequired(true)
                .setMinValue(1))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the timeout')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const targetUser = interaction.options.getUser('user');
        const duration = interaction.options.getInteger('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = interaction.member;

        // Check permissions
        if (!hasPermission(member, config.permissions.globaltimeout)) {
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
                .setDescription('❌ You cannot globally timeout yourself.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        const timeoutDuration = duration * 60 * 1000; // Convert to milliseconds
        const timedOutGuilds = [];
        const failedGuilds = [];

        // Process all timeouts in parallel
        const timeoutPromises = Array.from(client.guilds.cache.values()).map(async (guild) => {
            try {
                const guildMember = await guild.members.fetch(targetUser.id).catch(() => null);
                if (guildMember) {
                    await guildMember.timeout(timeoutDuration, `Global timeout by ${member.user.tag}: ${reason}`);
                    return { success: true, guildName: guild.name };
                }
                return { success: false, guildName: guild.name, error: 'User not in server' };
            } catch (error) {
                return { success: false, guildName: guild.name, error: error.message };
            }
        });

        const results = await Promise.allSettled(timeoutPromises);
        results.forEach((result) => {
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    timedOutGuilds.push(result.value.guildName);
                } else {
                    failedGuilds.push({ name: result.value.guildName, error: result.value.error });
                }
            } else {
                failedGuilds.push({ name: 'Unknown', error: result.reason?.message || 'Unknown error' });
            }
        });

        // Update UI immediately
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Global Timeout Executed')
            .setDescription(`User has been timed out in ${timedOutGuilds.length} server(s).`)
            .addFields(
                { name: 'User', value: `${targetUser}`, inline: true },
                { name: 'Duration', value: `${duration} minutes`, inline: true },
                { name: 'Servers', value: `${timedOutGuilds.length}`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.reply({
            embeds: [successEmbed],
            flags: MessageFlags.Ephemeral
        });

        // Send DM and log asynchronously (non-blocking)
        const promises = [];
        
        if (config.settings.sendDMs && targetUser) {
            promises.push(
                Promise.resolve().then(() => {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('You have been globally timed out')
                        .setDescription(`You have been timed out in all servers where this bot is present.\n\n**Duration:** ${duration} minutes\n**Timed out by:** ${member.user.tag}\n**Reason:** ${reason}`)
                        .setColor('#FF9900')
                        .setTimestamp();
                    
                    return targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
                })
            );
        }

        if (config.settings.logAllActions && config.channels.timeoutLogs) {
            promises.push(
                client.channels.fetch(config.channels.timeoutLogs).then(logChannel => {
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('Global Timeout Executed')
                            .addFields(
                                { name: 'Staff Member', value: `${member.user}`, inline: true },
                                { name: 'User Timed Out', value: `${targetUser}`, inline: true },
                                { name: 'Duration', value: `${duration} minutes`, inline: true },
                                { name: 'Reason', value: reason, inline: false },
                                { name: 'Timed out in', value: `${timedOutGuilds.length} server(s)`, inline: false }
                            )
                            .setColor('#FF9900')
                            .setTimestamp();
                        
                        return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }).catch(() => {})
            );
        }

        Promise.all(promises).catch(() => {});
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}
