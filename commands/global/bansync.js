const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bansync')
        .setDescription('Sync bans from main server to all other servers')
        .addStringOption(option =>
            option.setName('main_server_id')
                .setDescription('Main server ID to sync bans from (optional, defaults to current guild)')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const member = interaction.member;

        // Check permissions
        if (!hasPermission(member, config.permissions.bansync)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            return interaction.reply({ 
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Defer immediately to avoid interaction expiry during long-running sync work
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const mainServerId = interaction.options.getString('main_server_id') || interaction.guild.id;
        const mainServer = await client.guilds.fetch(mainServerId).catch(() => null);

        if (!mainServer) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Server Not Found')
                .setDescription('The specified main server could not be found.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.editReply({ embeds: [errorEmbed] });
        }

        try {
            // Get all bans from main server
            const bans = await mainServer.bans.fetch();
            const bannedUserIds = Array.from(bans.keys());
            
            if (bannedUserIds.length === 0) {
                const noBansEmbed = new EmbedBuilder()
                    .setTitle('⚠️ No Bans Found')
                    .setDescription(`No bans were found in the main server **${mainServer.name}**.`)
                    .setColor('#FF9900')
                    .setTimestamp();
                
                await interaction.editReply({
                    embeds: [noBansEmbed]
                });
                return;
            }

            let syncedCount = 0;
            let alreadyBannedCount = 0;
            let failedCount = 0;

            // Sync bans to all other servers
            for (const guild of client.guilds.cache.values()) {
                if (guild.id === mainServerId) continue; // Skip main server
                
                for (const userId of bannedUserIds) {
                    try {
                        // Check if already banned
                        try {
                            await guild.bans.fetch(userId);
                            alreadyBannedCount++;
                            continue;
                        } catch (error) {
                            // Not banned, proceed to ban
                        }

                        // Get ban reason from main server
                        const ban = bans.get(userId);
                        const reason = ban?.reason || `Synced from ${mainServer.name}`;

                        // Try to ban the user
                        try {
                            const user = await client.users.fetch(userId).catch(() => null);
                            if (user) {
                                await guild.bans.create(userId, { reason: reason });
                                syncedCount++;
                            }
                        } catch (error) {
                            failedCount++;
                            console.error(`Failed to ban ${userId} in ${guild.name}:`, error.message);
                        }
                    } catch (error) {
                        failedCount++;
                        console.error(`Error processing ban for ${userId} in ${guild.name}:`, error.message);
                    }
                }
            }

            // Log the action
            if (config.settings.logAllActions && config.channels.syncLogs) {
                const logChannel = await client.channels.fetch(config.channels.syncLogs).catch(() => null);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('Ban Sync Executed')
                        .addFields(
                            { name: 'Staff Member', value: `${member.user}`, inline: true },
                            { name: 'Main Server', value: `${mainServer.name}`, inline: true },
                            { name: 'Bans Synced', value: `${syncedCount}`, inline: true },
                            { name: 'Already Banned', value: `${alreadyBannedCount}`, inline: true },
                            { name: 'Failed', value: `${failedCount}`, inline: true },
                            { name: 'Total Servers', value: `${client.guilds.cache.size - 1}`, inline: false }
                        )
                        .setColor('#0099FF')
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Ban Sync Completed')
                .setDescription(`Bans have been synced from **${mainServer.name}** to all other servers.`)
                .addFields(
                    { name: 'Synced', value: `${syncedCount}`, inline: true },
                    { name: 'Already Banned', value: `${alreadyBannedCount}`, inline: true },
                    { name: 'Failed', value: `${failedCount}`, inline: true },
                    { name: 'Total Servers', value: `${client.guilds.cache.size - 1}`, inline: false }
                )
                .setColor('#0099FF')
                .setTimestamp();
            
            await interaction.editReply({
                embeds: [successEmbed]
            });
        } catch (error) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Ban Sync Failed')
                .setDescription(`Failed to sync bans: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();
            
            await safeEditReply(interaction, {
                embeds: [errorEmbed]
            });
        }
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

async function safeEditReply(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(payload);
        }
        return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch (e) {
        console.error('Failed to respond to interaction:', e?.message || e);
    }
}

