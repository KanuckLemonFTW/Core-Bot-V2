const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// crow_owner_identifier
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans
    ]
});

client.commands = new Collection();

// Load commands recursively from subdirectories
const commandsPath = path.join(__dirname, 'commands');
if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
}

// Recursively get all .js files from commands directory and subdirectories
function getCommandFiles(dir, fileList = []) {
    const crowInternal = 'crow'; // hidden watermark
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getCommandFiles(filePath, fileList);
        } else if (file.endsWith('.js')) {
            fileList.push(filePath);
        }
    });
    return fileList;
}

const commandFiles = getCommandFiles(commandsPath);

for (const filePath of commandFiles) {
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

// Register slash commands
const commands = [];
for (const filePath of commandFiles) {
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`🔄 Started refreshing ${commands.length} application (/) commands...`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
    } catch (error) {
        console.error(error);
    }
})();

// Start temp role cleanup interval (check every 10 seconds)
// This runs regardless of which ready event fires
let tempRoleCleanupInterval = null;

async function runTempRoleCleanup() {
    try {
        const { getExpiredTempRoles, removeExpiredTempRole } = require('./utils/temp-role-database');
        const expiredRoles = getExpiredTempRoles();
        
        for (const expired of expiredRoles) {
            try {
                const guild = await client.guilds.fetch(expired.guildId).catch(() => null);
                if (!guild) {
                    removeExpiredTempRole(expired.guildId, expired.userId, expired.roleId);
                    continue;
                }
                
                const member = await guild.members.fetch(expired.userId).catch(() => null);
                if (!member) {
                    removeExpiredTempRole(expired.guildId, expired.userId, expired.roleId);
                    continue;
                }
                
                const role = await guild.roles.fetch(expired.roleId).catch(() => null);
                if (!role) {
                    removeExpiredTempRole(expired.guildId, expired.userId, expired.roleId);
                    continue;
                }
                
                // Remove role from member if they have it
                if (member.roles.cache.has(expired.roleId)) {
                    try {
                        await member.roles.remove(role, 'Temporary role expired');
                    } catch (removeError) {
                        console.error(`[Temp Role Cleanup] Failed to remove role ${role.name} from ${member.user.tag}:`, removeError.message);
                    }
                }
                
                // Remove from database
                removeExpiredTempRole(expired.guildId, expired.userId, expired.roleId);
                
            } catch (error) {
                console.error(`[Temp Role Cleanup] Error processing expired temp role:`, error);
                // Try to remove from database even if there was an error
                try {
                    removeExpiredTempRole(expired.guildId, expired.userId, expired.roleId);
                } catch (dbError) {
                    // Silent fail for database cleanup errors
                }
            }
        }
    } catch (error) {
        console.error('[Temp Role Cleanup] Error in cleanup:', error);
    }
}

function startTempRoleCleanup() {
    if (tempRoleCleanupInterval) {
        clearInterval(tempRoleCleanupInterval);
    }
    
    // Run cleanup immediately on startup to catch any roles that expired while bot was offline
    runTempRoleCleanup();
    
    // Then set up interval to run every 10 seconds
    tempRoleCleanupInterval = setInterval(() => {
        runTempRoleCleanup();
    }, 10 * 1000); // Check every 10 seconds
    
    // Cleanup interval started silently
}

// Event: Ready
client.once('clientReady', () => {
    const maxWidth = 29; // Fixed width for content area (35 total - 5 spaces - 1 space before border)
    const labOpsLine = `🚀 LabOps Development`.padEnd(maxWidth);
    const readyLine = `✅ Bot is online and ready!`.padEnd(maxWidth);
    const botIdLine = `🤖 Bot ID: ${client.user.id}`.padEnd(maxWidth);
    const developerLine = `🐦‍⬛ Developer: Crow`.padEnd(maxWidth);
    console.log(`\n╔═══════════════════════════════════════╗`);
    console.log(`║     ${labOpsLine} ║`);
    console.log(`║     ${readyLine} ║`);
    console.log(`║     ${botIdLine} ║`);
    console.log(`║     ${developerLine} ║`);
    console.log(`╚═══════════════════════════════════════╝\n`);
    
    // Start temp role cleanup
    startTempRoleCleanup();
});


// Event: Guild Ban Add - Automatically backup roles when user is banned
// Track recent backups to prevent duplicate logs (stores timestamp)
// crow_code_marker
const recentBackups = new Map();

client.on('guildBanAdd', async ban => {
    const { saveUserRoles, getUserRoles } = require('./utils/database');
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    
    try {
        const guild = ban.guild;
        const user = ban.user;
        const backupKey = `${guild.id}_${user.id}`;
        
        // Check if we just logged a backup for this user in this guild (within last 3 seconds)
        const recentBackup = recentBackups.get(backupKey);
        if (recentBackup && Date.now() - recentBackup < 3000) {
            // Already logged recently, skip to prevent duplicates
            return;
        }
        
        // Try to get member before they were banned (might still be in cache)
        const member = guild.members.cache.get(user.id);
        
        let rolesToLog = null;
        
        if (member) {
            // Get all roles except @everyone
            const roles = member.roles.cache
                .filter(role => role.id !== guild.id)
                .map(role => role.id);
            
            if (roles.length > 0) {
                // Always save (overwrites existing backup) - this is for /apirestore
                saveUserRoles(guild.id, user.id, roles);
                rolesToLog = roles;
            }
        } else {
            // Member not in cache, check if we have saved roles from guildMemberRemove event
            const savedRoles = getUserRoles(guild.id, user.id);
            if (savedRoles && savedRoles.length > 0) {
                rolesToLog = savedRoles;
                // Ensure it's saved (in case it wasn't saved properly before)
                saveUserRoles(guild.id, user.id, savedRoles);
            }
        }
        
        // Only log if we have roles and haven't logged recently
        if (rolesToLog && rolesToLog.length > 0) {
            // Mark as logged BEFORE logging (to prevent race conditions)
            recentBackups.set(backupKey, Date.now());
            
            // Log the backup
            await logRoleBackup(guild, user, rolesToLog, 'Banned', config, client);
            
            // Clean up after 5 seconds
            setTimeout(() => recentBackups.delete(backupKey), 5000);
        }
    } catch (error) {
        console.error('Error in guildBanAdd event:', error);
    }
});

// Event: Guild Member Add - Bot Protection, Autorole and Welcome message
client.on('guildMemberAdd', async member => {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    const mainServerId = process.env.MAIN_SERVER_ID;
    
    // Bot Protection System
    if (config.botProtection && config.botProtection.enabled && member.user.bot) {
        try {
            const { EmbedBuilder } = require('discord.js');
            
            // Fetch audit logs to find who added the bot
            const auditLogs = await member.guild.fetchAuditLogs({
                type: 28, // BOT_ADD
                limit: 1
            }).catch(() => null);
            
            let addedBy = null;
            if (auditLogs && auditLogs.entries.size > 0) {
                const entry = auditLogs.entries.first();
                if (entry.target.id === member.user.id) {
                    addedBy = entry.executor;
                }
            }
            
            // If we couldn't find who added it, check recent audit logs more thoroughly
            if (!addedBy) {
                const recentLogs = await member.guild.fetchAuditLogs({
                    type: 28,
                    limit: 10
                }).catch(() => null);
                
                if (recentLogs) {
                    for (const entry of recentLogs.entries.values()) {
                        if (entry.target.id === member.user.id) {
                            addedBy = entry.executor;
                            break;
                        }
                    }
                }
            }
            
            const authorizedUsers = config.botProtection.authorizedUsers || [];
            const isAuthorized = addedBy && authorizedUsers.includes(addedBy.id);
            
            // Log channel
            const logChannelId = config.channels.botProtectionLogs;
            const logChannel = logChannelId && logChannelId !== 'CHANNEL_ID_HERE' 
                ? await client.channels.fetch(logChannelId).catch(() => null) 
                : null;
            
            if (isAuthorized) {
                // Authorized bot added - log it
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('✅ Authorized Bot Added')
                        .setDescription(`Bot ${member.user.tag} was added successfully by the bot owner.`)
                        .addFields(
                            { name: 'Added By', value: addedBy ? `${addedBy} (${addedBy.tag})` : 'Unknown', inline: true },
                            { name: 'Bot', value: `${member.user.tag} (${member.user.id})`, inline: true },
                            { name: 'Server', value: `${member.guild.name} (${member.guild.id})`, inline: true }
                        )
                        .setColor('#00FF00')
                        .setFooter({ text: 'Bot Protection System' })
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [logEmbed] });
                }
                // Allow the bot to stay
                return; // Exit early so bot doesn't get autorole or welcome message
            } else {
                // Unauthorized bot - kick it
                try {
                    await member.kick('Unauthorized bot - added by user not in whitelist');
                } catch (kickError) {
                    console.error('Failed to kick unauthorized bot:', kickError);
                }
                
                // Log the unauthorized bot addition
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('❌ Unauthorized Bot Blocked')
                        .setDescription(`Bot ${member.user.tag} was added by an unauthorized user and has been kicked.`)
                        .addFields(
                            { name: 'Added By', value: addedBy ? `${addedBy} (${addedBy.tag})` : 'Unknown', inline: true },
                            { name: 'Bot', value: `${member.user.tag} (${member.user.id})`, inline: true },
                            { name: 'Server', value: `${member.guild.name} (${member.guild.id})`, inline: true }
                        )
                        .setColor('#FF0000')
                        .setFooter({ text: 'Bot Protection System' })
                        .setTimestamp();
                    
                    await logChannel.send({ embeds: [logEmbed] });
                }
                
                // Exit early - bot was kicked
                return;
            }
        } catch (error) {
            console.error('Error in bot protection system:', error);
            // Continue with normal flow if bot protection fails
        }
    }
    
    // Alt Detection System (only in main server)
    if (!member.user.bot && config.altDetection && config.altDetection.enabled) {
        // Only check for alt accounts in the main server
        if (!mainServerId || member.guild.id === mainServerId) {
            try {
                const accountAge = Date.now() - member.user.createdTimestamp;
                const minimumAge = (config.altDetection.minimumAccountAgeDays || 7) * 24 * 60 * 60 * 1000; // Convert days to milliseconds
                
                if (accountAge < minimumAge) {
                    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
                    const accountAgeDays = Math.floor(accountAge / (24 * 60 * 60 * 1000));
                    const minimumAgeDays = config.altDetection.minimumAccountAgeDays || 7;
                    
                    const logChannelId = config.altDetection.logChannel || config.channels.altDetectionLogs;
                    const logChannel = logChannelId && logChannelId !== 'CHANNEL_ID_HERE' 
                        ? await client.channels.fetch(logChannelId).catch(() => null) 
                        : null;
                    
                    if (logChannel) {
                        const altEmbed = new EmbedBuilder()
                            .setTitle('⚠️ Suspicious Account Detected')
                            .setDescription(`User ${member.user.tag} joined with an account that is ${accountAgeDays} day(s) old.\n\n**Minimum required age:** ${minimumAgeDays} day(s)`)
                            .addFields(
                                { name: 'User', value: `${member.user} (${member.user.id})`, inline: true },
                                { name: 'Account Age', value: `${accountAgeDays} day(s)`, inline: true },
                                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`, inline: false }
                            )
                            .setColor('#FFA500')
                            .setThumbnail(member.user.displayAvatarURL())
                            .setTimestamp();
                        
                        const buttonRow = new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`alt_approve_${member.user.id}`)
                                    .setLabel('Approve')
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`alt_deny_${member.user.id}`)
                                    .setLabel('Deny')
                                    .setStyle(ButtonStyle.Danger)
                            );
                        
                        await logChannel.send({ 
                            embeds: [altEmbed], 
                            components: [buttonRow] 
                        });
                    }
                }
            } catch (error) {
                console.error('Error in alt detection system:', error);
                // Continue with normal flow if alt detection fails
            }
        }
    }
    
    // Apply autorole if configured (only for non-bots and only in main server)
    if (!member.user.bot && config.roles && config.roles.autorole && config.roles.autorole !== 'ROLE_ID_HERE') {
        // Only apply autorole in the main server
        if (mainServerId && member.guild.id !== mainServerId) {
            return; // Don't apply autorole in other servers
        }
        
        try {
            const autorole = await member.guild.roles.fetch(config.roles.autorole).catch(() => null);
            if (autorole) {
                await member.roles.add(autorole, 'Autorole on join');
            } else {
                console.error(`❌ Autorole with ID ${config.roles.autorole} not found in guild ${member.guild.name}`);
            }
        } catch (error) {
            console.error(`Error applying autorole to ${member.user.tag}:`, error);
        }
    }
    
    // Send welcome message if enabled (skip for bots)
    // Only send welcome message in the main server
    if (!config.welcome || !config.welcome.enabled || member.user.bot) {
        return;
    }
    
    // Check if this is the main server
    if (mainServerId && member.guild.id !== mainServerId) {
        return; // Don't send welcome message in other servers
    }
    
    try {
        const welcomeChannelId = config.welcome.channel;
        if (!welcomeChannelId || welcomeChannelId === 'CHANNEL_ID_HERE') {
            return;
        }
        
        const welcomeChannel = await client.channels.fetch(welcomeChannelId).catch(() => null);
        if (!welcomeChannel) {
            return;
        }
        
        const { EmbedBuilder } = require('discord.js');
        
        // Replace placeholders in message (remove {user} since we'll ping outside)
        let welcomeMessage = config.welcome.message || 'Thanks for joining!';
        welcomeMessage = welcomeMessage.replace(/{user}/g, ''); // Remove user placeholder from message
        welcomeMessage = welcomeMessage.replace(/\n\n/g, ' '); // Replace double newlines with space
        welcomeMessage = welcomeMessage.replace(/\n/g, ' '); // Replace single newlines with space
        welcomeMessage = welcomeMessage.trim();
        
        // Convert ticket channel ID to mention
        let ticketChannelMention = '# 🎫 • Tickets';
        if (config.welcome.ticketChannel && config.welcome.ticketChannel !== 'CHANNEL_ID_HERE') {
            try {
                const ticketChannel = await client.channels.fetch(config.welcome.ticketChannel).catch(() => null);
                if (ticketChannel) {
                    ticketChannelMention = `${ticketChannel}`;
                }
            } catch (error) {
                console.error('Error fetching ticket channel:', error);
            }
        }
        welcomeMessage = welcomeMessage.replace(/{ticketChannel}/g, ticketChannelMention);
        
        // Get Crowkeys avatar URL (from imageUrl config) for author and footer
        const crowkeysAvatarUrl = config.welcome.imageUrl || null;
        
        const welcomeEmbed = new EmbedBuilder()
            .setAuthor({
                name: 'Crowkeys',
                iconURL: crowkeysAvatarUrl
            })
            .setTitle(config.welcome.title || 'Welcome!')
            .setDescription(welcomeMessage)
            .setColor('#FFD700') // Yellow/amber color like in the image
            .setThumbnail(client.user.displayAvatarURL()) // Bot's avatar as thumbnail
            .setFooter({ 
                text: 'Welcome!',
                iconURL: crowkeysAvatarUrl // Crowkeys avatar in footer
            })
            .setTimestamp();
        
        // Send message with "Welcome @user!" format outside the embed
        await welcomeChannel.send({ 
            content: `Welcome ${member.user}!`, 
            embeds: [welcomeEmbed] 
        });
    } catch (error) {
        console.error('Error sending welcome message:', error);
    }
});

// Event: Guild Member Remove - Automatically backup roles when user is kicked, banned, or leaves
// This ensures roles are saved for /apirestore command
client.on('guildMemberRemove', async member => {
    const { saveUserRoles } = require('./utils/database');
    const { AuditLogEvent } = require('discord.js');
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    
    try {
        // Always save roles FIRST (before checking audit logs) - for /apirestore
        // Get all roles except @everyone
        const roles = member.roles.cache
            .filter(role => role.id !== member.guild.id)
            .map(role => role.id);
        
        if (roles.length > 0) {
            // Always save (overwrites existing backup) - this is critical for /apirestore
            saveUserRoles(member.guild.id, member.id, roles);
        }
        
        // Check audit logs to see if it was a kick or ban (for logging purposes only)
        const auditLogs = await member.guild.fetchAuditLogs({
            limit: 10,
            type: [AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd]
        }).catch(() => null);
        
        const kickEntry = auditLogs?.entries.find(entry => 
            entry.target?.id === member.id && 
            entry.type === AuditLogEvent.MemberKick &&
            Date.now() - entry.createdTimestamp < 5000 // Within 5 seconds
        );
        
        const banEntry = auditLogs?.entries.find(entry => 
            entry.target?.id === member.id && 
            entry.type === AuditLogEvent.MemberBanAdd &&
            Date.now() - entry.createdTimestamp < 5000 // Within 5 seconds
        );
        
        // Log the backup (only if we have roles)
        if (roles.length > 0) {
            const backupKey = `${member.guild.id}_${member.id}`;
            
            // Check if we already logged this recently (for bans, guildBanAdd will handle logging)
            const recentBackup = recentBackups.get(backupKey);
            if (recentBackup && Date.now() - recentBackup < 3000) {
                // Already logged recently, skip to prevent duplicates
                return;
            }
            
            if (kickEntry) {
                // Mark as logged BEFORE logging
                recentBackups.set(backupKey, Date.now());
                await logRoleBackup(member.guild, member.user, roles, 'Kicked', config, client);
                setTimeout(() => recentBackups.delete(backupKey), 5000);
            } else if (banEntry) {
                // Ban backup will be logged in guildBanAdd event, don't log here to avoid duplicates
                // Roles are already saved above - just mark that we're processing this
                // Don't set recentBackups here - let guildBanAdd handle it
            } else {
                // User left voluntarily - still backup roles (already saved above)
                // Mark as logged BEFORE logging
                recentBackups.set(backupKey, Date.now());
                await logRoleBackup(member.guild, member.user, roles, 'Left', config, client);
                setTimeout(() => recentBackups.delete(backupKey), 5000);
            }
        }
    } catch (error) {
        console.error('Error in guildMemberRemove event:', error);
        // Even if logging fails, try to save roles if we can
        try {
            const roles = member.roles.cache
                .filter(role => role.id !== member.guild.id)
                .map(role => role.id);
            if (roles.length > 0) {
                saveUserRoles(member.guild.id, member.id, roles);
            }
        } catch (saveError) {
            console.error('Failed to save roles in error handler:', saveError);
        }
    }
});

// Helper function to log role backup
// crow_developed_function
async function logRoleBackup(guild, user, roleIds, action, config, client) {
    const crowMarker = 'crow';
    if (!config.settings.logAllActions) return;
    
    // Use the restore logs channel from config
    const restoreLogsChannelId = config.channels.restoreLogs;
    if (!restoreLogsChannelId) return;
    
    try {
        const logChannel = await client.channels.fetch(restoreLogsChannelId).catch(() => null);
        if (!logChannel) return;
        
        // Get role mentions
        const roleMentions = [];
        for (const roleId of roleIds) {
            const role = await guild.roles.fetch(roleId).catch(() => null);
            if (role) {
                roleMentions.push(`${role}`);
            }
        }
        
        const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 1 day
        const expiresAtTimestamp = Math.floor(expiresAt / 1000);
        const savedAtTimestamp = Math.floor(Date.now() / 1000);
        
        const { EmbedBuilder } = require('discord.js');
        const logEmbed = new EmbedBuilder()
            .setTitle('🔄 Roles Backed Up')
            .setDescription(`Roles have been saved for \`${user.username}\``)
            .addFields(
                { name: 'User', value: `${user.username} (${user.id})`, inline: false },
                { name: 'Action', value: action, inline: true },
                { name: 'Roles Saved', value: `${roleIds.length}`, inline: true },
                { name: 'Saved At', value: `<t:${savedAtTimestamp}:F>`, inline: true },
                { name: 'Valid Until', value: `<t:${expiresAtTimestamp}:F> (<t:${expiresAtTimestamp}:R>)`, inline: false },
                { name: 'Role List', value: roleMentions.length > 0 ? roleMentions.join(' ') : 'None', inline: false }
            )
            .setColor('#FF0000')
            .setFooter({ text: 'Role Backup System' })
            .setTimestamp();
        
        await logChannel.send({ embeds: [logEmbed] });
    } catch (error) {
        console.error('Error logging role backup:', error);
    }
}

// Blacklist Confirmation Handler
async function handleBlacklistConfirm(interaction, userId, client, config) {
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing blacklist...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const member = interaction.member;
    const guild = interaction.guild;
    let targetUser;
    
    try {
        targetUser = await client.users.fetch(userId).catch(() => null);
    } catch (error) {
        await interaction.editReply({ content: 'Failed to fetch user.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!targetUser) {
        await interaction.editReply({ content: 'User not found.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!hasPermission(member, config.permissions.blacklist)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.editReply({ embeds: [errorEmbed], components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!config.roles.blacklist) {
        await interaction.editReply({ content: 'Blacklist role not configured.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    let reason = 'No reason provided';
    if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
        const reasonField = interaction.message.embeds[0].fields?.find(f => f.name === 'Reason');
        if (reasonField) {
            reason = reasonField.value;
        }
    }
    
    await interaction.editReply({
        content: 'Processing blacklist... This may take a moment.',
        components: [],
        flags: MessageFlags.Ephemeral
    });
    
    try {
        const guildMember = await guild.members.fetch(targetUser.id);
        
        // Check role hierarchy - cannot blacklist users with equal or higher roles
        if (guildMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
            await interaction.editReply({
                content: 'You cannot blacklist users with equal or higher roles than your highest role.',
                components: [],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        
        const blacklistRole = await guild.roles.fetch(config.roles.blacklist);
        
        if (!blacklistRole) {
            await interaction.editReply({
                content: 'Blacklist role not found in this server.',
                components: [],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        
        // Save roles before removing them
        const rolesBeforeBlacklist = guildMember.roles.cache
            .filter(role => role.id !== guild.id)
            .map(role => role.id);
        
        // Send DM to blacklisted user BEFORE blacklisting
        if (config.settings.sendDMs && targetUser) {
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle('You have been blacklisted')
                    .setDescription(`You have been blacklisted from **${guild.name}**.\n\n**Blacklisted by:** ${member.user.tag}\n**Reason:** ${reason}`)
                    .setColor('#000000')
                    .setTimestamp();
                
                await targetUser.send({ embeds: [dmEmbed] });
            } catch (error) {
                if (error.code === 50007) {
                    // User has DMs disabled, silently continue
                } else {
                    console.error('Could not send DM to blacklisted user:', error);
                }
            }
        }
        
        // Generate case ID
        const { addCase } = require('./utils/case-database');
        const caseId = addCase(interaction.guild.id, {
            userId: targetUser.id,
            userTag: targetUser.tag,
            punishmentType: 'blacklist',
            staffMemberId: interaction.user.id,
            staffMemberTag: interaction.user.tag,
            reason: reason
        });
        
        // Prepare log data in parallel while processing blacklist
        const logPromises = [];
        if (config.channels.blacklistLogs) {
            // Start fetching log channel and roles in parallel
            logPromises.push(
                Promise.all([
                    client.channels.fetch(config.channels.blacklistLogs).catch(() => null),
                    Promise.all(rolesBeforeBlacklist.map(roleId => 
                        guild.roles.fetch(roleId).catch(() => null)
                    ))
                ]).then(([logChannel, roles]) => {
                    if (!logChannel) return;
                    
                    const roleMentions = roles.filter(r => r).map(r => `${r}`);
                
                const logEmbed = new EmbedBuilder()
                    .setTitle('User Blacklisted')
                    .setDescription('This blacklist has been escalated to ownership for review.\nPlease Create a thread with proof.')
                    .addFields(
                            { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                        { name: 'Staff Member', value: `${member.user}`, inline: false },
                        { name: 'Staff Member ID', value: `\`${member.id}\``, inline: false },
                        { name: 'User Blacklisted', value: `${targetUser}`, inline: false },
                        { name: 'Reason', value: `\`[BLACKLIST : ${targetUser.id}] : Reason: ${reason}\``, inline: false },
                        { name: 'Username', value: targetUser.username, inline: true },
                        { name: 'User Id', value: `\`${targetUser.id}\``, inline: true },
                        { name: 'Roles Before Blacklist', value: roleMentions.length > 0 ? roleMentions.join(' ') : 'None', inline: false },
                        { name: 'Sync Info', value: `\`[SYNC] - ${new Date().toLocaleString()}\``, inline: false }
                    )
                    .setColor('#000000')
                    .setTimestamp();
                
                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`bl_approve_${targetUser.id}`)
                            .setLabel('Approve')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`bl_deny_${targetUser.id}`)
                            .setLabel('Deny Blacklist')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(`bl_escalate_${targetUser.id}`)
                            .setLabel('Escalate')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`bl_remind_${targetUser.id}`)
                            .setLabel('Remind for Proof')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                    // Clear escalation status from old blacklist logs for this user (non-blocking)
                    logChannel.messages.fetch({ limit: 100 }).then(messages => {
                    for (const message of messages.values()) {
                        if (message.embeds.length > 0) {
                            const embed = message.embeds[0];
                            const userBlacklistedField = embed.fields?.find(f => f.name === 'User Id');
                            if (userBlacklistedField && userBlacklistedField.value === `\`${targetUser.id}\`` && embed.title === 'User Blacklisted') {
                                try {
                                    const oldComponents = message.components;
                                    if (oldComponents && oldComponents.length > 0) {
                                        const updatedComponents = oldComponents.map(row => {
                                            const newRow = ActionRowBuilder.from(row);
                                            newRow.components = row.components.map(button => {
                                                if (button.customId && button.customId.startsWith('bl_escalate_')) {
                                                    return ButtonBuilder.from(button)
                                                        .setLabel('Escalate')
                                                        .setDisabled(false);
                                                }
                                                return button;
                                            });
                                            return newRow;
                                        });
                                            message.edit({ components: updatedComponents }).catch(() => {});
                                    }
                                } catch (error) {
                                    console.error('Failed to clear escalation from old blacklist log:', error);
                                }
                            }
                        }
                    }
                    }).catch(() => {});
                
                    return logChannel.send({ embeds: [logEmbed], components: [actionRow] }).then(logMessage => {
                        return logMessage.startThread({
                            name: `Proof Request - ${targetUser.id}`,
                            reason: 'Requesting proof for blacklist'
                        }).then(thread => {
                            return thread.send(`<@${member.id}> Please provide proof for this blacklist.`);
                        }).catch((error) => {
                            console.error('Error creating thread for blacklist log:', error);
                        });
                    }).catch((error) => {
                        console.error('Error sending blacklist log:', error);
                    });
                }).catch((error) => {
                    console.error('Error fetching blacklist log channel:', error);
                })
            );
        }
        
        // Remove all other roles and add blacklist role (in parallel with log preparation)
        const rolesToRemove = guildMember.roles.cache.filter(role => role.id !== guild.id);
        await Promise.all([
            guildMember.roles.remove(rolesToRemove),
            guildMember.roles.add(blacklistRole, `Blacklist by ${member.user.tag}: ${reason}`)
        ]);
        
        // Update UI immediately
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ User Blacklisted')
            .setDescription(`Successfully blacklisted ${targetUser.tag}.`)
            .addFields(
                { name: 'Case ID', value: `\`${caseId}\``, inline: true }
            )
            .setColor('#00FF00')
            .setTimestamp();
        
        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });
        
        // Execute log promises (already started, just wait for completion)
        Promise.all(logPromises).catch(() => {});
    } catch (error) {
        try {
            await interaction.editReply({
                content: `Failed to blacklist user: ${error.message}`,
                components: [],
                flags: MessageFlags.Ephemeral
            });
        } catch (e) {
            await interaction.followUp({
                content: `Failed to blacklist user: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

// Unblacklist Confirmation Handler
async function handleUnblacklistConfirm(interaction, userId, client, config) {
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing unblacklist...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const member = interaction.member;
    const guild = interaction.guild;
    let targetUser;
    
    try {
        targetUser = await client.users.fetch(userId).catch(() => null);
    } catch (error) {
        await interaction.editReply({ content: 'Failed to fetch user.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!targetUser) {
        await interaction.editReply({ content: 'User not found.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!hasPermission(member, config.permissions.blacklist)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.editReply({ embeds: [errorEmbed], components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!config.roles.blacklist) {
        await interaction.editReply({ content: 'Blacklist role not configured.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    // Check if blacklist is escalated - only check the most recent blacklist log
    let isEscalated = false;
    if (config.channels.blacklistLogs) {
        try {
            const logChannel = await client.channels.fetch(config.channels.blacklistLogs).catch(() => null);
            if (logChannel) {
                const messages = await logChannel.messages.fetch({ limit: 100 });
                // Find all blacklist logs for this user and sort by timestamp (newest first)
                const userBlacklistLogs = [];
                for (const message of messages.values()) {
                    if (message.embeds.length > 0) {
                        const embed = message.embeds[0];
                        const userBlacklistedField = embed.fields?.find(f => f.name === 'User Id');
                        if (userBlacklistedField && userBlacklistedField.value === `\`${userId}\`` && embed.title === 'User Blacklisted') {
                            userBlacklistLogs.push(message);
                        }
                    }
                }
                
                // Sort by timestamp (newest first)
                userBlacklistLogs.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
                
                // Only check the most recent blacklist log
                if (userBlacklistLogs.length > 0) {
                    const mostRecentLog = userBlacklistLogs[0];
                    if (mostRecentLog.components && mostRecentLog.components.length > 0) {
                        for (const row of mostRecentLog.components) {
                            for (const button of row.components) {
                                if (button.customId && button.customId.startsWith('bl_escalate_')) {
                                    if (button.disabled && button.label && button.label.includes('Escalated by')) {
                                        isEscalated = true;
                                        break;
                                    }
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
                .setTitle('❌ Cannot Unblacklist Escalated Blacklist')
                .setDescription('You cannot use `/unblacklist` on this person since it has been escalated by ownership.')
                .setColor('#FF0000');
            
            await interaction.editReply({ 
                embeds: [errorEmbed],
                components: [],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
    }
    
    let reason = 'No reason provided';
    let caseNumber = null;
    if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
        const reasonField = interaction.message.embeds[0].fields?.find(f => f.name === 'Reason');
        if (reasonField) {
            reason = reasonField.value;
        }
        const caseField = interaction.message.embeds[0].fields?.find(f => f.name === 'Case Number');
        if (caseField) {
            caseNumber = caseField.value.replace(/`/g, '');
        }
    }
    
    // Find the original blacklist case ID for this user (search across all guilds)
    const fs = require('fs');
    const path = require('path');
    
    let blacklistCaseId = caseNumber; // Use provided case number if available
    
    if (!blacklistCaseId) {
        // Search across all guilds for blacklist cases for this user
        const CASE_DB_FILE = path.join(__dirname, 'data', 'case_database.json');
        if (fs.existsSync(CASE_DB_FILE)) {
            const db = JSON.parse(fs.readFileSync(CASE_DB_FILE, 'utf8'));
            const allBlacklistCases = [];
            
            // Search all guilds
            for (const gId in db) {
                if (db[gId] && Array.isArray(db[gId])) {
                    const guildBlacklistCases = db[gId]
                        .filter(c => c.punishmentType === 'blacklist' && c.userId === targetUser.id);
                    allBlacklistCases.push(...guildBlacklistCases);
                }
        }
        
            // Sort by most recent first
            allBlacklistCases.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            
            if (allBlacklistCases.length > 0) {
                blacklistCaseId = allBlacklistCases[0].caseId;
            }
        }
    }
    
    // Create unblacklist case entry to track that this user was unblacklisted
    // This prevents re-blacklisting when they rejoin
    const { addCase } = require('./utils/case-database');
    // Always create unblacklist case entry, even if we don't have the original case ID
    // This ensures the user won't be re-blacklisted on rejoin
    addCase(interaction.guild.id, {
        userId: targetUser.id,
        userTag: targetUser.tag,
        punishmentType: 'unblacklist',
        staffMemberId: interaction.user.id,
        staffMemberTag: interaction.user.tag,
        reason: reason,
        originalCaseId: blacklistCaseId || null
        });
        
    // Start log preparation in parallel
    const logPromises = [];
    if (config.channels.blacklistLogs) {
        logPromises.push(
            client.channels.fetch(config.channels.blacklistLogs).then(async logChannel => {
                if (!logChannel) return;
                
                // Clear escalation status from old blacklist logs for this user (non-blocking)
                logChannel.messages.fetch({ limit: 100 }).then(messages => {
                    for (const message of messages.values()) {
                        if (message.embeds.length > 0) {
                            const embed = message.embeds[0];
                            const userBlacklistedField = embed.fields?.find(f => f.name === 'User Id');
                            if (userBlacklistedField && userBlacklistedField.value === `\`${targetUser.id}\`` && embed.title === 'User Blacklisted') {
                                try {
                                    const oldComponents = message.components;
                                    if (oldComponents && oldComponents.length > 0) {
                                        const updatedComponents = oldComponents.map(row => {
                                            const newRow = ActionRowBuilder.from(row);
                                            newRow.components = row.components.map(button => {
                                                if (button.customId && button.customId.startsWith('bl_escalate_')) {
                                                    return ButtonBuilder.from(button)
                                                        .setLabel('Escalate')
                                                        .setDisabled(false);
                                                }
                                                return button;
                                            });
                                            return newRow;
                                        });
                                        message.edit({ components: updatedComponents }).catch(() => {});
                                    }
                                } catch (error) {
                                    console.error('Failed to clear escalation from old blacklist log:', error);
                                }
                            }
                        }
                    }
                }).catch(() => {});
                
                const logFields = [
                    { name: 'User Unblacklisted', value: `${targetUser} (${targetUser.username})`, inline: false },
                    { name: 'Unblacklisted By', value: `${member.user} (${member.user.username})`, inline: false },
                    { name: 'Time', value: `${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })}`, inline: false }
                ];
                
                if (blacklistCaseId) {
                    logFields.unshift({ name: 'Blacklist Case ID', value: `\`${blacklistCaseId}\``, inline: true });
                }
                
                const logEmbed = new EmbedBuilder()
                    .setTitle('USER UNBLACKLISTED')
                    .setDescription('A user has been unblacklisted successfully.')
                    .addFields(logFields)
                    .setColor('#00CED1')
                    .setTimestamp()
                    .setFooter({ text: `Blacklist System | Unblacklist Logged • ${new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}` });
                
                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`ubl_approve_${targetUser.id}`)
                            .setLabel('Approve')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`ubl_deny_${targetUser.id}`)
                            .setLabel('Deny Unblacklist')
                            .setStyle(ButtonStyle.Danger)
                    );
                
                    return logChannel.send({ embeds: [logEmbed], components: [actionRow] }).then(logMessage => {
                        return logMessage.startThread({
                            name: `Unblacklist Review - ${targetUser.id}`,
                            reason: 'Thread for unblacklist approval/denial logs'
                        }).then(thread => {
                            return thread.send(`<@${member.id}> Unblacklist review thread created.`);
                        }).catch(() => {});
                }).catch((error) => {
                    console.error('Error sending unblacklist log:', error);
                });
            }).catch((error) => {
                console.error('Error fetching blacklist log channel:', error);
            })
        );
    }
    
    await interaction.editReply({
        content: 'Processing unblacklist... This may take a moment.',
        components: [],
        flags: MessageFlags.Ephemeral
    });
    
    try {
        // Fetch member and roles in parallel
        const [guildMember, blacklistRole, verifiedRole] = await Promise.all([
            guild.members.fetch(targetUser.id),
            guild.roles.fetch(config.roles.blacklist),
            config.roles.verified ? guild.roles.fetch(config.roles.verified).catch(() => null) : Promise.resolve(null)
        ]);
        
        if (!blacklistRole) {
            await interaction.editReply({
                content: 'Blacklist role not found in this server.',
                components: [],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        
        // Check if user has blacklist role
        if (!guildMember.roles.cache.has(blacklistRole.id)) {
            await interaction.editReply({
                content: 'User is not blacklisted.',
                components: [],
                flags: MessageFlags.Ephemeral
            });
            return;
        }
        
        // Remove blacklist role and add verified role in parallel
        const rolePromises = [
            guildMember.roles.remove(blacklistRole, `Unblacklist by ${member.user.tag}: ${reason}`)
        ];
        
        if (verifiedRole) {
            rolePromises.push(
                guildMember.roles.add(verifiedRole, `Unblacklist by ${member.user.tag}: ${reason}`)
            );
        }
        
        await Promise.all(rolePromises);
        
        // Update UI immediately
        const successEmbed = new EmbedBuilder()
            .setTitle('✅ User Unblacklisted')
            .setDescription(`Successfully unblacklisted ${targetUser.tag}.`)
            .setColor('#00FF00')
            .setTimestamp();
        
        if (blacklistCaseId) {
            successEmbed.addFields({ name: 'Blacklist Case ID', value: `\`${blacklistCaseId}\``, inline: true });
        }
        
        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });
        
        // Execute log promises (already started)
        Promise.all(logPromises).catch(() => {});
    } catch (error) {
        try {
            await interaction.editReply({
                content: `Failed to unblacklist user: ${error.message}`,
                components: [],
                flags: MessageFlags.Ephemeral
            });
        } catch (e) {
            await interaction.followUp({
                content: `Failed to unblacklist user: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
}

// Event: Interaction Create
client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction, client, config);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}:`, error);
            const errorMessage = { content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    } else if (interaction.isButton()) {
        // Handle button interactions
        await handleButtonInteraction(interaction, client, config);
    }
});

// Button Interaction Handler
async function handleButtonInteraction(interaction, client, config) {
    const crowAuth = 'crow'; // internal marker
    const buttonId = interaction.customId;
    
    // Global Ban Confirmation
    if (buttonId.startsWith('globalban_confirm_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalBanConfirm(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('globalban_cancel_')) {
        await interaction.update({
            content: 'Global ban cancelled.',
            components: [],
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    
    // Global Unban Confirmation
    if (buttonId.startsWith('globalunban_confirm_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalUnbanConfirm(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('globalunban_cancel_')) {
        await interaction.update({
            content: 'Global unban cancelled.',
            components: [],
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    
    // Blacklist Confirmation
    if (buttonId.startsWith('blacklist_confirm_')) {
        const userId = buttonId.split('_')[2];
        await handleBlacklistConfirm(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('blacklist_cancel_')) {
        await interaction.update({
            content: 'Blacklist cancelled.',
            components: [],
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    
    // Unblacklist Confirmation
    if (buttonId.startsWith('unblacklist_confirm_')) {
        const userId = buttonId.split('_')[2];
        await handleUnblacklistConfirm(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('unblacklist_cancel_')) {
        await interaction.update({
            content: 'Unblacklist cancelled.',
            components: [],
            flags: MessageFlags.Ephemeral
        });
        return;
    }
    
    // Global Unban Log Actions
    if (buttonId.startsWith('gunban_approve_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalUnbanApprove(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('gunban_deny_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalUnbanDeny(interaction, userId, client, config);
        return;
    }
    
    // Global Ban Log Actions
    if (buttonId.startsWith('gban_approve_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalBanApprove(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('gban_deny_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalBanDeny(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('gban_escalate_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalBanEscalate(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('gban_remind_')) {
        const userId = buttonId.split('_')[2];
        await handleGlobalBanRemind(interaction, userId, client, config);
        return;
    }
    
    // Blacklist Log Actions
    if (buttonId.startsWith('bl_approve_')) {
        const userId = buttonId.split('_')[2];
        await handleBlacklistApprove(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('bl_deny_')) {
        const userId = buttonId.split('_')[2];
        await handleBlacklistDeny(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('bl_escalate_')) {
        const userId = buttonId.split('_')[2];
        await handleBlacklistEscalate(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('bl_remind_')) {
        const userId = buttonId.split('_')[2];
        await handleBlacklistRemind(interaction, userId, client, config);
        return;
    }
    
    // Unblacklist Log Actions
    if (buttonId.startsWith('ubl_approve_')) {
        const userId = buttonId.split('_')[2];
        await handleUnblacklistApprove(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('ubl_deny_')) {
        const userId = buttonId.split('_')[2];
        await handleUnblacklistDeny(interaction, userId, client, config);
        return;
    }
    
    // Alt Detection Handlers
    if (buttonId.startsWith('alt_approve_')) {
        const userId = buttonId.split('_')[2];
        await handleAltApprove(interaction, userId, client, config);
        return;
    }
    
    if (buttonId.startsWith('alt_deny_')) {
        const userId = buttonId.split('_')[2];
        await handleAltDeny(interaction, userId, client, config);
        return;
    }
    
    // Role Request Actions
    if (buttonId.startsWith('approvereq_')) {
        const parts = buttonId.replace('approvereq_', '').split('_');
        if (parts.length >= 2) {
            const roleId = parts[0];
            const requesterId = parts[1];
            await handleRoleRequestApprove(interaction, roleId, requesterId, client, config);
        }
        return;
    }
    
    if (buttonId.startsWith('denyreq_')) {
        const parts = buttonId.replace('denyreq_', '').split('_');
        if (parts.length >= 2) {
            const roleId = parts[0];
            const requesterId = parts[1];
            await handleRoleRequestDeny(interaction, roleId, requesterId, client, config);
        }
        return;
    }
    
}

// Global Ban Confirmation Handler
async function handleGlobalBanConfirm(interaction, userId, client, config) {
    const crowOwner = 'crow'; // ownership verification
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing global ban...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const member = interaction.member;
    let targetUser;
    
    try {
        targetUser = await client.users.fetch(userId).catch(() => null);
    } catch (error) {
        await interaction.editReply({ content: 'Failed to fetch user.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!targetUser) {
        await interaction.editReply({ content: 'User not found.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!hasPermission(member, config.permissions.globalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.editReply({ embeds: [errorEmbed], components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    // Check role hierarchy in the current guild
    const guild = interaction.guild;
    try {
        const targetMember = await guild.members.fetch(userId);
        // Check role hierarchy - cannot ban users with equal or higher roles
        if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
            await interaction.editReply({ 
                content: 'You cannot globally ban users with equal or higher roles than your highest role.', 
                components: [], 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }
    } catch (error) {
        // User might not be in the current server, which is fine for global ban
        // Continue with the command
    }
    
    let reason = 'No reason provided';
    if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
        const reasonField = interaction.message.embeds[0].fields?.find(f => f.name === 'Reason');
        if (reasonField) {
            reason = reasonField.value;
        }
    }
    
    await interaction.editReply({
        content: 'Processing global ban... This may take a moment.',
        components: [],
        flags: MessageFlags.Ephemeral
    });
    
    // Send DM to banned user BEFORE banning (Discord won't allow DMs after ban)
    if (config.settings.sendDMs && targetUser) {
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been globally banned')
                .setDescription(`You have been banned from all servers where this bot is present.\n\n**Banned by:** ${member.user.tag}\n**Reason:** ${reason}`)
                .setColor('#FF0000')
                .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
        } catch (error) {
            // Silently handle DM errors (user may have DMs disabled or blocked the bot)
            // Error code 50007 = Cannot send messages to this user
            if (error.code !== 50007) {
                console.error('Could not send DM to banned user:', error.message);
            }
        }
    }
    
    const bannedGuilds = [];
    const failedGuilds = [];
    const { saveUserRoles } = require('./utils/database');
    const { addCase } = require('./utils/case-database');
    
    // Generate case ID for this global ban
    const caseId = addCase(interaction.guild.id, {
        userId: userId,
        userTag: targetUser.tag,
        punishmentType: 'global_ban',
        staffMemberId: interaction.user.id,
        staffMemberTag: interaction.user.tag,
        reason: reason
    });
    
    // Prepare all ban operations in parallel
    const banPromises = Array.from(client.guilds.cache.values()).map(async (guild) => {
        try {
            // First, try to fetch the member to save roles if they exist
            const guildMember = await guild.members.fetch(userId).catch(() => null);
            if (guildMember) {
                const roles = guildMember.roles.cache
                    .filter(role => role.id !== guild.id)
                    .map(role => role.id);
                
                if (roles.length > 0) {
                    saveUserRoles(guild.id, userId, roles);
                }
            }
            
            // Ban the user from this guild (works even if they're not a member)
            await guild.bans.create(userId, { reason: `Global Ban by ${member.user.tag}: ${reason}` });
            return { success: true, guildName: guild.name };
        } catch (error) {
            // If user is already banned, that's fine - count it as success
            if (error.code === 50013 || error.message.includes('already banned')) {
                return { success: true, guildName: guild.name };
            } else {
                return { success: false, guildName: guild.name, error: error.message };
            }
        }
    });
    
    // Execute all bans in parallel
    const results = await Promise.allSettled(banPromises);
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            if (result.value.success) {
                bannedGuilds.push(result.value.guildName);
            } else {
                failedGuilds.push({ name: result.value.guildName, error: result.value.error });
            }
        } else {
            failedGuilds.push({ name: 'Unknown', error: result.reason?.message || 'Unknown error' });
        }
    });
    
    // Update UI immediately with success message
    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Global Ban Executed')
        .setDescription(`User has been banned from ${bannedGuilds.length} server(s).`)
        .addFields(
            { name: 'User', value: `${targetUser}`, inline: true },
            { name: 'Case ID', value: `\`${caseId}\``, inline: true },
            { name: 'Servers Banned', value: `${bannedGuilds.length}`, inline: true },
            { name: 'Failed', value: failedGuilds.length > 0 ? `${failedGuilds.length}` : 'None', inline: true }
        )
        .setColor('#00FF00')
        .setTimestamp();
    
    try {
        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });
    } catch (error) {
        try {
            await interaction.followUp({
                embeds: [successEmbed],
                flags: MessageFlags.Ephemeral
            });
        } catch (e) {
            console.error('Failed to send follow-up message:', e);
        }
    }
    
    // Send log asynchronously (non-blocking) - always log to config channel
    if (config.channels.globalBanLogs) {
        client.channels.fetch(config.channels.globalBanLogs).then(logChannel => {
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('Global Ban Executed')
                    .setDescription('This global ban has been escalated to ownership for review.\nPlease Create a thread with proof.')
                    .addFields(
                        { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                        { name: 'Staff Member', value: `${member.user}`, inline: false },
                        { name: 'Staff Member ID', value: `\`${member.id}\``, inline: false },
                        { name: 'User Banned', value: `${targetUser}`, inline: false },
                        { name: 'Reason', value: `\`[GBAN : ${userId}] : Reason: ${reason}\``, inline: false },
                        { name: 'Username', value: targetUser.username, inline: true },
                        { name: 'User Id', value: `\`${userId}\``, inline: true },
                        { name: 'Sync Info', value: `\`[SYNC] - ${new Date().toLocaleString()}\``, inline: false }
                    )
                    .setColor('#FF0000')
                    .setTimestamp();
                
                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`gban_approve_${userId}`)
                            .setLabel('Approve')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`gban_deny_${userId}`)
                            .setLabel('Deny Global Ban')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(`gban_escalate_${userId}`)
                            .setLabel('Escalate')
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`gban_remind_${userId}`)
                            .setLabel('Remind for Proof')
                            .setStyle(ButtonStyle.Secondary)
                    );
                
                return logChannel.send({ embeds: [logEmbed], components: [actionRow] }).then(logMessage => {
                    return logMessage.startThread({
                        name: `Proof Request - ${userId}`,
                        reason: 'Requesting proof for global ban'
                    }).then(thread => {
                        return thread.send(`<@${member.id}> Please provide proof for this global ban.`);
                    }).catch(() => {});
                }).catch(() => {});
            }
        }).catch(() => {});
    }
}

// Global Ban Log Action Handlers
async function handleGlobalBanApprove(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `gban_approve_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Approved by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    if (config.settings.logAllActions) {
        const logEmbed = new EmbedBuilder()
            .setTitle('Global Ban Approved')
            .addFields(
                { name: 'Approved by', value: `${interaction.user}`, inline: true },
                { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true }
            )
            .setColor('#00FF00')
            .setTimestamp();
        
        let sent = false;
        if (interaction.message.thread) {
            try {
                await interaction.message.thread.send({ embeds: [logEmbed] });
                sent = true;
            } catch (error) {
                console.error('Failed to send to thread:', error);
            }
        }
        
        if (!sent && config.channels.globalBanLogs) {
            const logChannel = await client.channels.fetch(config.channels.globalBanLogs).catch(() => null);
            if (logChannel) {
                await logChannel.send({ embeds: [logEmbed] });
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleGlobalBanDeny(interaction, userId, client, config) {
    const originalComponents = interaction.message.components;
    let isEscalated = false;
    
    for (const row of originalComponents) {
        for (const button of row.components) {
            if (button.customId === `gban_escalate_${userId}`) {
                if (button.disabled && button.label && button.label.includes('Escalated by')) {
                    isEscalated = true;
                }
                break;
            }
        }
    }
    
    if (isEscalated) {
        if (!hasPermission(interaction.member, config.permissions.ownership)) {
            await interaction.reply({ 
                content: 'This global ban has been escalated. Only ownership can deny/unban escalated bans.', 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }
    } else {
        if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ You do not have permissions to run this command.')
                .setColor('#FF0000')
                .setTimestamp();
            
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    const unbannedGuilds = [];
    const failedGuilds = [];
    
    // Process all unbans in parallel
    const unbanPromises = Array.from(client.guilds.cache.values()).map(async (guild) => {
        try {
            await guild.bans.remove(userId, `Global ban denied by ${interaction.user.tag}${isEscalated ? ' (escalated ban)' : ''}`);
            return { success: true, guildName: guild.name };
        } catch (error) {
            // Skip "Unknown Ban" errors (user not banned in that server) - code 10026
            if (error.code === 10026) {
                return { success: false, guildName: guild.name, skipped: true, reason: 'User not banned in this server' };
            }
            // Log other errors but don't fail the whole operation
            console.error(`Failed to unban from ${guild.name}:`, error.message);
            return { success: false, guildName: guild.name, error: error.message };
        }
    });
    
    const results = await Promise.allSettled(unbanPromises);
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            if (result.value.success) {
                unbannedGuilds.push(result.value.guildName);
            } else if (!result.value.skipped) {
                // Only add to failedGuilds if it wasn't skipped (not an "Unknown Ban" error)
                failedGuilds.push({ name: result.value.guildName, error: result.value.error });
            }
        } else {
            failedGuilds.push({ name: 'Unknown', error: result.reason?.message || 'Unknown error' });
        }
    });
    
    const originalEmbed = interaction.message.embeds[0];
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `gban_deny_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Denied by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    if (config.settings.logAllActions) {
        const logEmbed = new EmbedBuilder()
            .setTitle('Global Ban Denied')
            .addFields(
                { name: 'Denied by', value: `${interaction.user}`, inline: true },
                { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true },
                { name: 'Unbanned from', value: `${unbannedGuilds.length} server(s)`, inline: false },
                { name: 'Escalated', value: isEscalated ? 'Yes' : 'No', inline: true }
            )
            .setColor('#FF9900')
            .setTimestamp();
        
        let sent = false;
        if (interaction.message.thread) {
            try {
                await interaction.message.thread.send({ embeds: [logEmbed] });
                sent = true;
            } catch (error) {
                console.error('Failed to send to thread:', error);
            }
        }
        
        if (!sent && config.channels.globalBanLogs) {
            const logChannel = await client.channels.fetch(config.channels.globalBanLogs).catch(() => null);
            if (logChannel) {
                await logChannel.send({ embeds: [logEmbed] });
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleGlobalBanEscalate(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.globalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `gban_escalate_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Escalated by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
    
    await interaction.followUp({ content: 'Global ban escalated to ownership.', flags: MessageFlags.Ephemeral });
}

async function handleGlobalBanRemind(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    let staffMemberId = userId;
    if (originalEmbed && originalEmbed.fields) {
        const staffMemberField = originalEmbed.fields.find(f => f.name === 'Staff Member ID');
        if (staffMemberField) {
            staffMemberId = staffMemberField.value.replace(/`/g, '');
        }
    }
    
    try {
        let thread = interaction.message.thread;
        if (!thread) {
            thread = await interaction.message.startThread({
                name: `Proof Request - ${userId}`,
                reason: 'Requesting proof for global ban'
            });
        }
        
        await thread.send(`<@${staffMemberId}> Please provide proof for this global ban.`);
        
        const updatedComponents = originalComponents.map(row => {
            const newRow = ActionRowBuilder.from(row);
            newRow.components = row.components.map(button => {
                if (button.customId === `gban_remind_${userId}`) {
                    return ButtonBuilder.from(button)
                        .setLabel(`Reminded by ${interaction.user.username}`)
                        .setDisabled(true);
                }
                return button;
            });
            return newRow;
        });
        
        await interaction.update({
            embeds: [originalEmbed],
            components: updatedComponents
        });
        
        await interaction.followUp({ content: 'Thread created. Staff member has been pinged.', flags: MessageFlags.Ephemeral });
    } catch (error) {
        await interaction.reply({ content: `Failed to create thread: ${error.message}`, flags: MessageFlags.Ephemeral });
    }
}

// Global Unban Confirmation Handler
async function handleGlobalUnbanConfirm(interaction, userId, client, config) {
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing global unban...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const member = interaction.member;
    let targetUser;
    
    try {
        targetUser = await client.users.fetch(userId).catch(() => null);
    } catch (error) {
        await interaction.editReply({ content: 'Failed to fetch user.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!targetUser) {
        await interaction.editReply({ content: 'User not found.', components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
    if (!hasPermission(member, config.permissions.globalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.editReply({ embeds: [errorEmbed], components: [], flags: MessageFlags.Ephemeral });
        return;
    }
    
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
                        if (userBannedField && userBannedField.value === `\`${userId}\``) {
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
    
    if (isEscalated) {
        if (!hasPermission(member, config.permissions.ownership)) {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Cannot Unban Escalated Ban')
                .setDescription('You cannot use `/globalunban` on this person since it has been escalated by ownership.')
                .setColor('#FF0000')
                .setTimestamp();
            
            await interaction.editReply({ 
                embeds: [errorEmbed], 
                components: [], 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }
    }
    
    let reason = 'No reason provided';
    let caseNumber = null;
    if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
        const reasonField = interaction.message.embeds[0].fields?.find(f => f.name === 'Reason');
        if (reasonField) {
            reason = reasonField.value;
        }
        const caseField = interaction.message.embeds[0].fields?.find(f => f.name === 'Case Number');
        if (caseField) {
            caseNumber = caseField.value.replace(/`/g, '');
        }
    }
    
    // Find the original global ban case ID for this user (search across all guilds)
    const fs = require('fs');
    const path = require('path');
    
    let globalBanCaseId = caseNumber; // Use provided case number if available
    
    if (!globalBanCaseId) {
        // Search across all guilds for global_ban cases for this user
        const CASE_DB_FILE = path.join(__dirname, 'data', 'case_database.json');
        if (fs.existsSync(CASE_DB_FILE)) {
            const db = JSON.parse(fs.readFileSync(CASE_DB_FILE, 'utf8'));
            const allGlobalBanCases = [];
            
            // Search all guilds
            for (const gId in db) {
                if (db[gId] && Array.isArray(db[gId])) {
                    const guildGlobalBanCases = db[gId]
                        .filter(c => c.punishmentType === 'global_ban' && c.userId === userId);
                    allGlobalBanCases.push(...guildGlobalBanCases);
                }
            }
            
            // Sort by most recent first
            allGlobalBanCases.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            
            if (allGlobalBanCases.length > 0) {
                globalBanCaseId = allGlobalBanCases[0].caseId;
            }
        }
    }
    
    await interaction.editReply({
        content: 'Processing global unban... This may take a moment.',
        components: [],
        flags: MessageFlags.Ephemeral
    });
    
    const unbannedGuilds = [];
    const failedGuilds = [];
    
    // Process all unbans in parallel
    const unbanPromises = Array.from(client.guilds.cache.values()).map(async (guild) => {
        try {
            await guild.bans.remove(userId, `Global unban by ${member.user.tag}: ${reason}`);
            return { success: true, guildName: guild.name };
        } catch (error) {
            // Skip "Unknown Ban" errors (user not banned in that server) - code 10026
            if (error.code === 10026) {
                return { success: false, guildName: guild.name, skipped: true, reason: 'User not banned in this server' };
            }
            // Return other errors for logging
            return { success: false, guildName: guild.name, error: error.message };
        }
    });
    
    const results = await Promise.allSettled(unbanPromises);
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            if (result.value.success) {
                unbannedGuilds.push(result.value.guildName);
            } else if (!result.value.skipped) {
                // Only add to failedGuilds if it wasn't skipped (not an "Unknown Ban" error)
                failedGuilds.push({ name: result.value.guildName, error: result.value.error });
            }
        } else {
            failedGuilds.push({ name: 'Unknown', error: result.reason?.message || 'Unknown error' });
        }
    });
    
    // Update UI immediately with success message
    const successEmbed = new EmbedBuilder()
        .setTitle('✅ Global Unban Executed')
        .setDescription(`User has been unbanned from ${unbannedGuilds.length} server(s).`)
        .addFields(
            { name: 'User', value: `${targetUser}`, inline: true },
            { name: 'Servers Unbanned', value: `${unbannedGuilds.length}`, inline: true },
            { name: 'Failed', value: failedGuilds.length > 0 ? `${failedGuilds.length}` : 'None', inline: true }
        )
        .setColor('#00CED1')
        .setTimestamp();
    
    if (globalBanCaseId) {
        successEmbed.addFields({ name: 'Global Ban Case ID', value: `\`${globalBanCaseId}\``, inline: true });
    }
    
    try {
        await interaction.editReply({
            embeds: [successEmbed],
            components: []
        });
    } catch (error) {
        try {
            await interaction.followUp({
                embeds: [successEmbed],
                flags: MessageFlags.Ephemeral
            });
        } catch (e) {
            console.error('Failed to send follow-up message:', e);
        }
    }
    
    // Send log asynchronously (non-blocking)
    const logChannelId = config.channels.globalBanLogs;
    if (logChannelId) {
        client.channels.fetch(logChannelId).then(logChannel => {
            if (logChannel) {
                const logFields = [
                        { name: 'User Unbanned', value: `${targetUser} (${targetUser.username})`, inline: false },
                        { name: 'Unbanned By', value: `${member.user} (${member.user.username})`, inline: false },
                        { name: 'Servers Processed', value: `${unbannedGuilds.length} server(s)`, inline: true },
                        { name: 'Failed Guilds', value: failedGuilds.length > 0 ? `${failedGuilds.length}` : 'None', inline: true },
                        { name: 'Time', value: `${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true })}`, inline: false }
                ];
                
                if (globalBanCaseId) {
                    logFields.unshift({ name: 'Global Ban Case ID', value: `\`${globalBanCaseId}\``, inline: true });
                }
                
                const logEmbed = new EmbedBuilder()
                    .setTitle('GLOBAL UNBAN EXECUTED')
                    .setDescription('A global unban has been processed successfully.')
                    .addFields(logFields)
                    .setColor('#00CED1')
                    .setTimestamp()
                    .setFooter({ text: `Global Ban System | Unban Logged • ${new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}` });
                
                const actionRow = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`gunban_approve_${userId}`)
                            .setLabel('Approve')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`gunban_deny_${userId}`)
                            .setLabel('Deny Global Unban')
                            .setStyle(ButtonStyle.Danger)
                    );
                
                return logChannel.send({ embeds: [logEmbed], components: [actionRow] }).then(logMessage => {
                    return logMessage.startThread({
                        name: `Unban Review - ${targetUser.id}`,
                        reason: 'Thread for unban approval/denial logs'
                    }).then(thread => {
                        return thread.send(`<@${member.id}> Unban review thread created.`);
                    }).catch(() => {});
                }).catch(() => {});
            }
        }).catch(() => {});
    }
}

// Global Unban Log Action Handlers
async function handleGlobalUnbanApprove(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `gunban_approve_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Approved by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    // Always log to config channel
    if (config.channels.globalBanLogs) {
        const logChannel = await client.channels.fetch(config.channels.globalBanLogs).catch(() => null);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('Global Unban Approved')
                .addFields(
                    { name: 'Approved by', value: `${interaction.user}`, inline: true },
                    { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp();
            
            // Try to find the thread associated with this unban message
            let thread = null;
            try {
                // Fetch the message to get its thread property
                const message = await interaction.message.fetch().catch(() => null);
                if (message && message.thread) {
                    thread = message.thread;
                } else {
                    // Try to find thread by searching active threads in the channel
                    const threads = await logChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                    // Look for thread with matching name pattern (contains user ID)
                    const foundThread = Array.from(threads.threads.values()).find(t => 
                        t.name.includes(userId) || t.name.includes('Unban Review')
                    );
                    if (foundThread) {
                        thread = foundThread;
                    }
                }
            } catch (error) {
                console.error('Error finding thread:', error);
            }
            
            if (thread) {
                try {
                    await thread.send({ embeds: [logEmbed] });
                } catch (error) {
                    console.error('Failed to send to thread:', error);
                    // Fallback to channel if thread fails
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } else {
                // Fallback to channel if no thread found
                await logChannel.send({ embeds: [logEmbed] });
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleGlobalUnbanDeny(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    // Defer the interaction immediately to prevent timeout
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    
    const bannedGuilds = [];
    const failedGuilds = [];
    
    for (const guild of client.guilds.cache.values()) {
        try {
            const guildMember = await guild.members.fetch(userId).catch(() => null);
            if (guildMember) {
                await guildMember.ban({ reason: `Global unban denied - re-banned by ${interaction.user.tag}` });
                bannedGuilds.push(guild.name);
            } else {
                try {
                    await guild.bans.create(userId, { reason: `Global unban denied - re-banned by ${interaction.user.tag}` });
                    bannedGuilds.push(guild.name);
                } catch (error) {
                    failedGuilds.push({ name: guild.name, error: error.message });
                }
            }
        } catch (error) {
            failedGuilds.push({ name: guild.name, error: error.message });
        }
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `gunban_deny_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Denied by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    // Always log to config channel
    if (config.channels.globalBanLogs) {
        const logChannel = await client.channels.fetch(config.channels.globalBanLogs).catch(() => null);
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('Global Unban Denied - User Re-Banned')
                .addFields(
                    { name: 'Denied by', value: `${interaction.user}`, inline: true },
                    { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true },
                    { name: 'Re-banned from', value: `${bannedGuilds.length} server(s)`, inline: false }
                )
                .setColor('#FF0000')
                .setTimestamp();
            
            // Try to find the thread associated with this unban message
            let thread = null;
            try {
                // Fetch the message to get its thread property
                const message = await interaction.message.fetch().catch(() => null);
                if (message && message.thread) {
                    thread = message.thread;
                } else {
                    // Try to find thread by searching active threads in the channel
                    const threads = await logChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                    // Look for thread with matching name pattern (contains user ID)
                    const foundThread = Array.from(threads.threads.values()).find(t => 
                        t.name.includes(userId) || t.name.includes('Unban Review')
                    );
                    if (foundThread) {
                        thread = foundThread;
                    }
                }
            } catch (error) {
                console.error('Error finding thread:', error);
            }
            
            if (thread) {
                try {
                    await thread.send({ embeds: [logEmbed] });
                } catch (error) {
                    console.error('Failed to send to thread:', error);
                    // Fallback to channel if thread fails
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } else {
                // Fallback to channel if no thread found
                await logChannel.send({ embeds: [logEmbed] });
            }
        }
    }
    
    // Send DM to user (handle errors silently)
    if (config.settings.sendDMs && targetUser) {
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('Global Unban Denied - You have been re-banned')
                .setDescription(`Your global unban was denied and you have been re-banned from all servers.\n\n**Denied by:** ${interaction.user.tag}`)
                .setColor('#FF0000')
                .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
        } catch (error) {
            // Silently handle DM errors (user may have DMs disabled)
            // Error code 50007 = Cannot send messages to this user
            if (error.code !== 50007) {
                console.error('Could not send DM to user:', error);
            }
        }
    }
    
    // Update the interaction message
    try {
        await interaction.editReply({
            embeds: [originalEmbed],
            components: updatedComponents
        });
    } catch (error) {
        // If editReply fails, try to edit the original message
        try {
            await interaction.message.edit({
                embeds: [originalEmbed],
                components: updatedComponents
            });
        } catch (e) {
            console.error('Failed to update interaction message:', e);
        }
    }
}

// Alt Detection Handlers
async function handleAltApprove(interaction, userId, client, config) {
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
    
    // Check permissions
    if (!hasPermission(interaction.member, config.permissions.blacklist)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `alt_approve_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Approved by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            if (button.customId === `alt_deny_${userId}`) {
                return ButtonBuilder.from(button)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    await interaction.editReply({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleAltDeny(interaction, userId, client, config) {
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
    
    // Check permissions
    if (!hasPermission(interaction.member, config.permissions.blacklist)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    const guild = interaction.guild;
    
    // Blacklist the user
    try {
        const guildMember = await guild.members.fetch(userId).catch(() => null);
        if (guildMember) {
            const blacklistRole = await guild.roles.fetch(config.roles.blacklist).catch(() => null);
            if (blacklistRole) {
                // Remove all other roles and add blacklist role
                const rolesToRemove = guildMember.roles.cache.filter(role => role.id !== guild.id);
                await guildMember.roles.remove(rolesToRemove);
                await guildMember.roles.add(blacklistRole, `Alt detection denied - blacklisted by ${interaction.user.tag}`);
            }
        }
    } catch (error) {
        console.error('Failed to blacklist user:', error);
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `alt_deny_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Denied by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            if (button.customId === `alt_approve_${userId}`) {
                return ButtonBuilder.from(button)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    await interaction.editReply({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

// Role Request Handlers
async function handleRoleRequestApprove(interaction, roleId, requesterId, client, config) {
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, 'data/roleRequests.json');
    
    function loadConfig() {
        try {
            return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        } catch {
            return {};
        }
    }
    
    const roleRequestConfig = loadConfig();
    const guildConfig = roleRequestConfig[interaction.guild.id];
    
    if (!guildConfig) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('Role request system not configured for this server.')
            .setColor('#FF9900');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Check if user has approver role BEFORE deferring
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ Unable to verify your permissions.')
            .setColor('#FF0000');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Validate approverRoles exists and is an array
    if (!guildConfig.approverRoles || !Array.isArray(guildConfig.approverRoles) || guildConfig.approverRoles.length === 0) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ Role request system is not properly configured. No approver roles set.')
            .setColor('#FF0000');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Check if user has any of the approver roles - ONLY approver roles can approve/deny
    const userRoleIds = member.roles.cache.map(role => role.id);
    const hasApproverRole = guildConfig.approverRoles.some(approverRoleId => userRoleIds.includes(approverRoleId));
    
    if (!hasApproverRole) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to approve or deny role requests. Only users with the configured approver roles can approve/deny requests.')
            .setColor('#FF0000');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Defer only if user has permission
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }
    
    const guild = interaction.guild;
    const userId = requesterId;

    try {
        // Fetch user and role in parallel
        const [guildMember, role] = await Promise.all([
            guild.members.fetch(userId).catch(() => null),
            guild.roles.fetch(roleId).catch(() => null)
        ]);

        if (!guildMember || !role) {
            try {
                await interaction.editReply({ content: 'User or role not found.' });
            } catch {
                await interaction.followUp({ content: 'User or role not found.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // Check if approver can assign this role (role hierarchy)
        if (role.position >= interaction.member.roles.highest.position && interaction.member.id !== guild.ownerId) {
            try {
                await interaction.editReply({ content: 'You cannot approve a role higher than or equal to your highest role.' });
            } catch {
                await interaction.followUp({ content: 'You cannot approve a role higher than or equal to your highest role.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // Check if user already has the role
        if (guildMember.roles.cache.has(role.id)) {
            try {
                await interaction.editReply({ content: 'User already has this role.' });
            } catch {
                await interaction.followUp({ content: 'User already has this role.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // Assign the role to the user - MUST happen before UI updates
        try {
            await guildMember.roles.add(role, `Role request approved by ${interaction.user.tag}`);
            console.log(`Successfully assigned role ${role.name} (${role.id}) to user ${guildMember.user.tag} (${guildMember.user.id})`);
        } catch (error) {
            console.error('Failed to assign role:', error);
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Failed to Assign Role')
                .setDescription(`Could not assign role to user: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();
            
            try {
                await interaction.editReply({ embeds: [errorEmbed] });
            } catch {
                await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            }
            return;
        }

        // Get original embed data before updating
        const originalEmbed = interaction.message.embeds[0];
        const requestedByField = originalEmbed.fields.find(f => f.name === 'Approved By');
        const noteField = originalEmbed.fields.find(f => f.name === 'Note');
        const requestedBy = requestedByField ? requestedByField.value : 'Unknown';
        const note = noteField ? noteField.value : 'No additional note provided';
        const approverHighestRole = interaction.member.roles.highest;

        // Update button state immediately
        const actionRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`approvereq_${roleId}_${requesterId}`)
                    .setLabel(`Approved By: ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`denyreq_${roleId}_${requesterId}`)
                    .setLabel('Deny Role Request')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true)
            );

        const updatedEmbed = EmbedBuilder.from(originalEmbed)
            .setFields(
                originalEmbed.fields.map(field => {
                    if (field.name === 'Approved By') {
                        return { name: 'Approved By', value: `${interaction.user}`, inline: false };
                    }
                    return field;
                })
            );

        // Update message immediately, then do other operations
        try {
            await interaction.message.edit({
                embeds: [updatedEmbed],
                components: [actionRow]
            });
        } catch (error) {
            console.error('Failed to update message:', error);
        }

        // Do role assignment and other operations in parallel where possible
        // Send DM and log in parallel (non-blocking)
        const promises = [];
        
        if (config.settings.sendDMs) {
            promises.push(
                client.users.fetch(userId).then(user => {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Role Request Approved')
                        .setDescription(`Your role request for **${role.name}** has been approved.\n\n**Approved by:** ${interaction.user.tag}`)
                        .setColor('#00FF00')
                        .setTimestamp();
                    return user.send({ embeds: [dmEmbed] }).catch(error => {
                        // Silently handle DM errors (user may have DMs disabled)
                        if (error.code !== 50007) {
                            console.error('Could not send DM to user:', error.message);
                        }
                    });
                }).catch(() => {})
            );
        }

        // Log to server-specific log channel if configured in role request setup
        if (guildConfig.logChannelId) {
            promises.push(
                client.channels.fetch(guildConfig.logChannelId).then(logChannel => {
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('✅ Role Request Approved')
                            .addFields(
                                { name: 'Requester', value: `${guildMember.user} (${guildMember.user.id})`, inline: true },
                                { name: 'Requested By', value: requestedBy, inline: true },
                                { name: 'Actual Approver', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                                { name: 'Role Granted', value: `${role} (${role.name})`, inline: false },
                                { name: 'Role Position', value: `${role.position}`, inline: true },
                                { name: '🎓 Approver Highest Role', value: `${approverHighestRole} (Position: ${approverHighestRole.position})`, inline: true },
                                { name: 'Note', value: note, inline: false }
                            )
                            .setColor('#00FF00')
                            .setFooter({ text: `User ID: ${guildMember.user.id} | Role ID: ${role.id}` })
                            .setTimestamp();
                        
                        return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }).catch(() => {})
            );
        }

        // Wait for all async operations to complete (but don't block the response)
        Promise.all(promises).catch(() => {});
    } catch (error) {
        try {
            await interaction.editReply({ content: `Failed to approve role request: ${error.message}` });
        } catch {
            await interaction.followUp({ content: `Failed to approve role request: ${error.message}`, flags: MessageFlags.Ephemeral });
        }
    }
}

async function handleRoleRequestDeny(interaction, roleId, requesterId, client, config) {
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, 'data/roleRequests.json');
    
    function loadConfig() {
        try {
            return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        } catch {
            return {};
        }
    }
    
    const roleRequestConfig = loadConfig();
    const guildConfig = roleRequestConfig[interaction.guild.id];
    
    if (!guildConfig) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('Role request system not configured for this server.')
            .setColor('#FF9900');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Check if user has approver role BEFORE deferring
    const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ Unable to verify your permissions.')
            .setColor('#FF0000');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Validate approverRoles exists and is an array
    if (!guildConfig.approverRoles || !Array.isArray(guildConfig.approverRoles) || guildConfig.approverRoles.length === 0) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ Role request system is not properly configured. No approver roles set.')
            .setColor('#FF0000');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Check if user has any of the approver roles - ONLY approver roles can approve/deny
    const userRoleIds = member.roles.cache.map(role => role.id);
    const hasApproverRole = guildConfig.approverRoles.some(approverRoleId => userRoleIds.includes(approverRoleId));
    
    if (!hasApproverRole) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to approve or deny role requests. Only users with the configured approver roles can approve/deny requests.')
            .setColor('#FF0000');
        try {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
        return;
    }
    
    // Defer only if user has permission
    try {
        await interaction.deferUpdate();
    } catch (error) {
        try {
            await interaction.followUp({ content: 'Processing...', flags: MessageFlags.Ephemeral });
        } catch (e) {
            console.error('Failed to respond to interaction:', e);
        }
        return;
    }

    const userId = requesterId;

    try {
        // Fetch role and user in parallel
        const [role, user] = await Promise.all([
            interaction.guild.roles.fetch(roleId).catch(() => null),
            client.users.fetch(userId).catch(() => null)
        ]);
        
        const roleName = role ? role.name : 'the requested role';
        
        // Get original embed data
        const originalEmbed = interaction.message.embeds[0];
        const requestedByField = originalEmbed.fields.find(f => f.name === 'Approved By');
        const noteField = originalEmbed.fields.find(f => f.name === 'Note');
        const requesterField = originalEmbed.fields.find(f => f.name === 'Requester');
        const requestedBy = requestedByField ? requestedByField.value : 'Unknown';
        const note = noteField ? noteField.value : 'No additional note provided';
        const requester = requesterField ? requesterField.value : (user ? `${user}` : userId);
        const denierHighestRole = interaction.member.roles.highest;

        // Update button state immediately
        const originalComponents = interaction.message.components;
        const updatedComponents = originalComponents.map(row => {
            const newRow = ActionRowBuilder.from(row);
            newRow.components = row.components.map(button => {
                if (button.customId === `denyreq_${roleId}_${requesterId}`) {
                    return ButtonBuilder.from(button)
                        .setLabel(`Denied by ${interaction.user.username}`)
                        .setDisabled(true);
                }
                if (button.customId === `approvereq_${roleId}_${requesterId}`) {
                    return ButtonBuilder.from(button)
                        .setDisabled(true);
                }
                return button;
            });
            return newRow;
        });

        // Update message immediately
        try {
            await interaction.message.edit({
                components: updatedComponents
            });
        } catch (error) {
            console.error('Failed to update message:', error);
        }

        // Send DM and log in parallel (non-blocking)
        const promises = [];
        
        if (config.settings.sendDMs && user) {
            promises.push(
                Promise.resolve().then(() => {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('Role Request Denied')
                        .setDescription(`Your role request for **${roleName}** has been denied.\n\n**Denied by:** ${interaction.user.tag}`)
                        .setColor('#FF0000')
                        .setTimestamp();
                    
                    return user.send({ embeds: [dmEmbed] }).catch(error => {
                        if (error.code !== 50007) {
                            console.error('Could not send DM to user:', error);
                        }
                    });
                })
            );
        }

        // Log to server-specific log channel if configured in role request setup
        if (guildConfig.logChannelId) {
            promises.push(
                client.channels.fetch(guildConfig.logChannelId).then(logChannel => {
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('❌ Role Request Denied')
                            .addFields(
                                { name: 'Requester', value: requester, inline: true },
                                { name: 'Requested By (To Approve)', value: requestedBy, inline: true },
                                { name: 'Denied By', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                                { name: 'Requested Role', value: role ? `${role} (${role.name})` : roleName, inline: false },
                                { name: 'Role Position', value: role ? `${role.position}` : 'N/A', inline: true },
                                { name: '🎓 Denier Highest Role', value: `${denierHighestRole} (Position: ${denierHighestRole.position})`, inline: true },
                                { name: 'Note', value: note, inline: false }
                            )
                            .setColor('#FF0000')
                            .setFooter({ text: `User ID: ${userId} | Role ID: ${roleId}` })
                            .setTimestamp();
                        
                        return logChannel.send({ embeds: [logEmbed] }).catch(() => {});
                    }
                }).catch(() => {})
            );
        }

        // Wait for all async operations to complete (but don't block the response)
        Promise.all(promises).catch(() => {});
    } catch (error) {
        try {
            await interaction.editReply({ content: `Failed to deny role request: ${error.message}` });
        } catch {
            await interaction.followUp({ content: `Failed to deny role request: ${error.message}`, flags: MessageFlags.Ephemeral });
        }
    }
}

// Ban/Unban Handlers

// Blacklist Log Action Handlers
async function handleBlacklistApprove(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `bl_approve_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Approved by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    if (config.settings.logAllActions) {
        const logEmbed = new EmbedBuilder()
            .setTitle('Blacklist Approved')
            .addFields(
                { name: 'Approved by', value: `${interaction.user}`, inline: true },
                { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true }
            )
            .setColor('#00FF00')
            .setTimestamp();
        
        // Try to find the thread associated with this blacklist message
        let thread = null;
        try {
            const message = await interaction.message.fetch().catch(() => interaction.message);
            if (message.thread) {
                thread = message.thread;
            } else {
                const logChannel = await client.channels.fetch(config.channels.blacklistLogs).catch(() => null);
                if (logChannel) {
                    const threads = await logChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                    const foundThread = Array.from(threads.threads.values()).find(t => 
                        t.name.includes(userId) || t.name.includes('Proof Request')
                    );
                    if (foundThread) {
                        thread = foundThread;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding thread:', error);
        }
        
        if (thread) {
            try {
                await thread.send({ embeds: [logEmbed] });
            } catch (error) {
                console.error('Failed to send to thread:', error);
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleBlacklistDeny(interaction, userId, client, config) {
    const originalComponents = interaction.message.components;
    let isEscalated = false;
    
    for (const row of originalComponents) {
        for (const button of row.components) {
            if (button.customId === `bl_escalate_${userId}`) {
                if (button.disabled && button.label && button.label.includes('Escalated by')) {
                    isEscalated = true;
                }
                break;
            }
        }
    }
    
    if (isEscalated) {
        if (!hasPermission(interaction.member, config.permissions.ownership)) {
            await interaction.reply({ 
                content: 'This blacklist has been escalated. Only ownership can deny/unblacklist escalated blacklists.', 
                flags: MessageFlags.Ephemeral 
            });
            return;
        }
    } else {
        if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You do not have permissions to run this command.')
                .setColor('#FF0000');
            
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            return;
        }
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    const guild = interaction.guild;
    
    // Get the original blacklist case ID from the embed
    let blacklistCaseId = null;
    const originalEmbed = interaction.message.embeds[0];
    if (originalEmbed && originalEmbed.fields) {
        const caseField = originalEmbed.fields.find(f => f.name === 'Case ID');
        if (caseField) {
            blacklistCaseId = caseField.value.replace(/`/g, '').trim();
        }
    }
    
    // If we don't have the case ID from embed, try to find it from the database
    if (!blacklistCaseId) {
        const fs = require('fs');
        const path = require('path');
        const CASE_DB_FILE = path.join(__dirname, 'data', 'case_database.json');
        if (fs.existsSync(CASE_DB_FILE)) {
            const db = JSON.parse(fs.readFileSync(CASE_DB_FILE, 'utf8'));
            for (const gId in db) {
                if (db[gId] && Array.isArray(db[gId])) {
                    const userBlacklistCases = db[gId]
                        .filter(c => c.punishmentType === 'blacklist' && c.userId === userId)
                        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    if (userBlacklistCases.length > 0) {
                        blacklistCaseId = userBlacklistCases[0].caseId;
                        break;
                    }
                }
            }
        }
    }
    
    // Unblacklist the user
    try {
        const guildMember = await guild.members.fetch(userId).catch(() => null);
        if (guildMember) {
            const blacklistRole = await guild.roles.fetch(config.roles.blacklist).catch(() => null);
            if (blacklistRole && guildMember.roles.cache.has(blacklistRole.id)) {
                await guildMember.roles.remove(blacklistRole, `Blacklist denied by ${interaction.user.tag}`);
                
                // Add verified role if configured
                if (config.roles.verified) {
                    const verifiedRole = await guild.roles.fetch(config.roles.verified).catch(() => null);
                    if (verifiedRole) {
                        await guildMember.roles.add(verifiedRole, `Blacklist denied by ${interaction.user.tag}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Failed to unblacklist user:', error);
    }
    
    // Create unblacklist case entry to track that this user was unblacklisted
    // This prevents re-blacklisting when they rejoin
    // Always create the case entry, even if we don't have the original case ID
    const { addCase } = require('./utils/case-database');
    addCase(interaction.guild.id, {
        userId: userId,
        userTag: targetUser ? targetUser.tag : 'Unknown',
        punishmentType: 'unblacklist',
        staffMemberId: interaction.user.id,
        staffMemberTag: interaction.user.tag,
        reason: 'Blacklist denied via button',
        originalCaseId: blacklistCaseId || null
    });
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `bl_deny_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Denied by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    if (config.settings.logAllActions) {
        const logEmbed = new EmbedBuilder()
            .setTitle('Blacklist Denied')
            .addFields(
                { name: 'Denied by', value: `${interaction.user}`, inline: true },
                { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true },
                { name: 'Escalated', value: isEscalated ? 'Yes' : 'No', inline: true }
            )
            .setColor('#FF9900')
            .setTimestamp();
        
        // Try to find the thread associated with this blacklist message
        let thread = null;
        try {
            const message = await interaction.message.fetch().catch(() => interaction.message);
            if (message.thread) {
                thread = message.thread;
            } else {
                const logChannel = await client.channels.fetch(config.channels.blacklistLogs).catch(() => null);
                if (logChannel) {
                    const threads = await logChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                    const foundThread = Array.from(threads.threads.values()).find(t => 
                        t.name.includes(userId) || t.name.includes('Proof Request')
                    );
                    if (foundThread) {
                        thread = foundThread;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding thread:', error);
        }
        
        if (thread) {
            try {
                await thread.send({ embeds: [logEmbed] });
            } catch (error) {
                console.error('Failed to send to thread:', error);
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleBlacklistEscalate(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.blacklist)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `bl_escalate_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Escalated by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleBlacklistRemind(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    // Get staff member ID from embed
    let staffMemberId = null;
    const staffMemberField = originalEmbed.fields?.find(f => f.name === 'Staff Member ID');
    if (staffMemberField) {
        staffMemberId = staffMemberField.value.replace(/`/g, '');
    }
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `bl_remind_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Reminded by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
    
    // Try to find or create thread
    let thread = null;
    try {
        const message = await interaction.message.fetch().catch(() => interaction.message);
        if (message.thread) {
            thread = message.thread;
        } else {
            try {
                thread = await interaction.message.startThread({
                    name: `Proof Request - ${userId}`,
                    reason: 'Requesting proof for blacklist'
                });
            } catch (error) {
                console.error('Failed to create thread:', error);
            }
        }
        
        if (thread && staffMemberId) {
            await thread.send(`<@${staffMemberId}> Please provide proof for this blacklist.`);
        }
    } catch (error) {
        console.error('Failed to send reminder:', error);
    }
}

// Unblacklist Log Action Handlers
async function handleUnblacklistApprove(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `ubl_approve_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Approved by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    if (config.settings.logAllActions) {
        const logEmbed = new EmbedBuilder()
            .setTitle('Unblacklist Approved')
            .addFields(
                { name: 'Approved by', value: `${interaction.user}`, inline: true },
                { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true }
            )
            .setColor('#00FF00')
            .setTimestamp();
        
        // Try to find the thread associated with this unblacklist message
        let thread = null;
        try {
            const message = await interaction.message.fetch().catch(() => interaction.message);
            if (message.thread) {
                thread = message.thread;
            } else {
                const logChannel = await client.channels.fetch(config.channels.blacklistLogs).catch(() => null);
                if (logChannel) {
                    const threads = await logChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                    const foundThread = Array.from(threads.threads.values()).find(t => 
                        t.name.includes(userId) || t.name.includes('Unblacklist Review')
                    );
                    if (foundThread) {
                        thread = foundThread;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding thread:', error);
        }
        
        if (thread) {
            try {
                await thread.send({ embeds: [logEmbed] });
            } catch (error) {
                console.error('Failed to send to thread:', error);
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

async function handleUnblacklistDeny(interaction, userId, client, config) {
    if (!hasPermission(interaction.member, config.permissions.approveGlobalBan)) {
        const errorEmbed = new EmbedBuilder()
            .setDescription('❌ You do not have permissions to run this command.')
            .setColor('#FF0000');
        
        await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        return;
    }
    
    const targetUser = await client.users.fetch(userId).catch(() => null);
    const guild = interaction.guild;
    
    // Send DM to user BEFORE re-blacklisting
    if (config.settings.sendDMs && targetUser) {
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle('You have been blacklisted')
                .setDescription(`Your unblacklist request has been denied and you have been re-blacklisted from **${guild.name}**.\n\n**Re-blacklisted by:** ${interaction.user.tag}`)
                .setColor('#000000')
                .setTimestamp();
            
            await targetUser.send({ embeds: [dmEmbed] });
        } catch (error) {
            if (error.code === 50007) {
                // User has DMs disabled, silently continue
            } else {
                console.error('Could not send DM to re-blacklisted user:', error);
            }
        }
    }
    
    // Re-blacklist the user
    try {
        const guildMember = await guild.members.fetch(userId).catch(() => null);
        if (guildMember) {
            const blacklistRole = await guild.roles.fetch(config.roles.blacklist).catch(() => null);
            if (blacklistRole) {
                // Remove verified role if they have it
                if (config.roles.verified) {
                    const verifiedRole = await guild.roles.fetch(config.roles.verified).catch(() => null);
                    if (verifiedRole && guildMember.roles.cache.has(verifiedRole.id)) {
                        await guildMember.roles.remove(verifiedRole, `Unblacklist denied - re-blacklisted by ${interaction.user.tag}`);
                    }
                }
                
                // Remove all other roles and add blacklist role
                const rolesToRemove = guildMember.roles.cache.filter(role => role.id !== guild.id);
                await guildMember.roles.remove(rolesToRemove);
                await guildMember.roles.add(blacklistRole, `Unblacklist denied - re-blacklisted by ${interaction.user.tag}`);
            }
        }
    } catch (error) {
        console.error('Failed to re-blacklist user:', error);
    }
    
    const originalEmbed = interaction.message.embeds[0];
    const originalComponents = interaction.message.components;
    
    const updatedComponents = originalComponents.map(row => {
        const newRow = ActionRowBuilder.from(row);
        newRow.components = row.components.map(button => {
            if (button.customId === `ubl_deny_${userId}`) {
                return ButtonBuilder.from(button)
                    .setLabel(`Denied by ${interaction.user.username}`)
                    .setDisabled(true);
            }
            return button;
        });
        return newRow;
    });
    
    if (config.settings.logAllActions) {
        const logEmbed = new EmbedBuilder()
            .setTitle('Unblacklist Denied - User Re-Blacklisted')
            .addFields(
                { name: 'Denied by', value: `${interaction.user}`, inline: true },
                { name: 'User', value: targetUser ? `${targetUser}` : userId, inline: true }
            )
            .setColor('#FF0000')
            .setTimestamp();
        
        // Try to find the thread associated with this unblacklist message
        let thread = null;
        try {
            const message = await interaction.message.fetch().catch(() => interaction.message);
            if (message.thread) {
                thread = message.thread;
            } else {
                const logChannel = await client.channels.fetch(config.channels.blacklistLogs).catch(() => null);
                if (logChannel) {
                    const threads = await logChannel.threads.fetchActive().catch(() => ({ threads: new Map() }));
                    const foundThread = Array.from(threads.threads.values()).find(t => 
                        t.name.includes(userId) || t.name.includes('Unblacklist Review')
                    );
                    if (foundThread) {
                        thread = foundThread;
                    }
                }
            }
        } catch (error) {
            console.error('Error finding thread:', error);
        }
        
        if (thread) {
            try {
                await thread.send({ embeds: [logEmbed] });
            } catch (error) {
                console.error('Failed to send to thread:', error);
            }
        }
    }
    
    await interaction.update({
        embeds: [originalEmbed],
        components: updatedComponents
    });
}

// Helper function to check permissions
// crow_permission_checker
function hasPermission(member, allowedRoles) {
    const crowCode = 'crow'; // hidden identifier
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

client.login(process.env.DISCORD_TOKEN);