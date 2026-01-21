const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { saveUserRoles } = require('../../utils/database');
const { addCase } = require('../../utils/case-database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalrolestripe')
        .setDescription('Globally remove all roles from a user in all servers')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to strip roles from')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the role strip')
                .setRequired(false)),
    async execute(interaction, client, config) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
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

        // Prevent self-targeting
        if (targetUser.id === interaction.user.id) {
            const errorEmbed = new EmbedBuilder()
                .setDescription('❌ You cannot globally role strip yourself.')
                .setColor('#FF0000')
                .setTimestamp();
            
            return interaction.reply({
                embeds: [errorEmbed],
                flags: MessageFlags.Ephemeral
            });
        }

        // Check role hierarchy in the current guild
        const guild = interaction.guild;
        try {
            const targetMember = await guild.members.fetch(targetUser.id);
            // Check role hierarchy - cannot strip roles from users with equal or higher roles
            if (targetMember.roles.highest.position >= member.roles.highest.position && member.id !== guild.ownerId) {
                const errorEmbed = new EmbedBuilder()
                    .setDescription('You cannot strip roles from users with equal or higher roles than your highest role.')
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

        // Save roles from the main server only before stripping
        const mainServerId = process.env.MAIN_SERVER_ID;
        let mainServerRoles = [];
        let mainServerRoleMentions = [];
        
        if (mainServerId) {
            try {
                const mainGuild = await client.guilds.fetch(mainServerId).catch(() => null);
                if (mainGuild) {
                    const mainGuildMember = await mainGuild.members.fetch(targetUser.id).catch(() => null);
                    if (mainGuildMember) {
                        // Get roles before stripping (excluding @everyone)
                        mainServerRoles = mainGuildMember.roles.cache
                            .filter(role => role.id !== mainGuild.id)
                            .map(role => role.id);
                        
                        // Save roles to database for main server
                        if (mainServerRoles.length > 0) {
                            saveUserRoles(mainGuild.id, targetUser.id, mainServerRoles);
                        }
                        
                        // Get role mentions for the log
                        for (const roleId of mainServerRoles) {
                            const role = await mainGuild.roles.fetch(roleId).catch(() => null);
                            if (role) {
                                mainServerRoleMentions.push(`${role}`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error saving roles from main server:', error);
            }
        }

        // Generate case ID
        const caseId = addCase(interaction.guild.id, {
            userId: targetUser.id,
            userTag: targetUser.tag,
            punishmentType: 'global_rolestripe',
            staffMemberId: interaction.user.id,
            staffMemberTag: interaction.user.tag,
            reason: reason
        });

        const strippedGuilds = [];
        const failedGuilds = [];
        const auditReason = clampAuditLogReason(`Global role strip by ${member.user.tag}: ${reason}`);

        for (const guild of client.guilds.cache.values()) {
            try {
                const guildMember = await guild.members.fetch(targetUser.id).catch(() => null);
                if (guildMember) {
                    const rolesToRemove = guildMember.roles.cache.filter(role => role.id !== guild.id); // Keep @everyone role
                    await guildMember.roles.remove(rolesToRemove, auditReason);
                    strippedGuilds.push(guild.name);
                }
            } catch (error) {
                failedGuilds.push({ name: guild.name, error: error.message });
            }
        }

        // Send DM to user
        if (config.settings.sendDMs && targetUser) {
            try {
                const safeReasonForDm = clampEmbedDescription(reason, 1500);
                const dmEmbed = new EmbedBuilder()
                    .setTitle('Your roles have been globally stripped')
                    .setDescription(`All your roles have been removed in all servers where this bot is present.\n\n**Stripped by:** ${member.user.tag}\n**Reason:** ${safeReasonForDm}`)
                    .setColor('#FF9900')
                    .setTimestamp();
                
                await targetUser.send({ embeds: [dmEmbed] });
            } catch (error) {
                console.error('Could not send DM to user:', error);
            }
        }

        // Log the action - always log to config channel
        if (config.channels.globalRolestripeLogs) {
            const logChannel = await client.channels.fetch(config.channels.globalRolestripeLogs).catch(() => null);
            if (logChannel) {
                const logFields = [
                    { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                    { name: 'Staff Member', value: `${member.user}`, inline: false },
                    { name: 'User Stripped', value: `${targetUser}`, inline: false },
                    { name: 'Reason', value: clampEmbedFieldValue(reason), inline: false },
                    { name: 'Stripped in', value: `${strippedGuilds.length} server(s)`, inline: true }
                ];
                
                // Add roles from main server if available
                if (mainServerRoleMentions.length > 0) {
                    const chunks = chunkForEmbedField(mainServerRoleMentions, { maxLen: 1024, separator: ' ' });
                    const remainingFieldSlots = Math.max(0, 25 - logFields.length);
                    const maxRoleCharsToLog = 3000; // keep embed safely under Discord's total-size limit
                    const chunksToAdd = [];
                    let roleChars = 0;
                    for (const chunk of chunks) {
                        if (chunksToAdd.length >= remainingFieldSlots) break;
                        if (roleChars + chunk.length > maxRoleCharsToLog) break;
                        chunksToAdd.push(chunk);
                        roleChars += chunk.length;
                    }
                    
                    for (let i = 0; i < chunksToAdd.length; i++) {
                        logFields.push({
                            name: chunksToAdd.length === 1 ? 'Roles in Main Server' : `Roles in Main Server (${i + 1}/${chunksToAdd.length})`,
                            value: chunksToAdd[i],
                            inline: false
                        });
                    }
                    
                    const droppedChunks = chunks.length - chunksToAdd.length;
                    if (droppedChunks > 0 && logFields.length < 25) {
                        logFields.push({
                            name: 'Roles in Main Server (truncated)',
                            value: clampEmbedFieldValue(`Too many roles to display. Omitted ${droppedChunks} chunk(s) due to embed limits.`),
                            inline: false
                        });
                    }
                }
                
                const logEmbed = new EmbedBuilder()
                    .setTitle('Global Role Strip Executed')
                    .addFields(logFields)
                    .setColor('#FF9900')
                    .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] });
            }
        }

        const successEmbed = new EmbedBuilder()
            .setTitle('✅ Global Role Strip Executed')
            .setDescription(`Roles have been stripped from ${targetUser} across all servers.`)
            .addFields(
                { name: 'User', value: `${targetUser}`, inline: true },
                { name: 'Case ID', value: `\`${caseId}\``, inline: true },
                { name: 'Servers Affected', value: `${strippedGuilds.length}`, inline: true },
                { name: 'Reason', value: clampEmbedFieldValue(reason), inline: false }
            )
            .setColor('#FF9900')
            .setTimestamp();
        
        await interaction.editReply({
            embeds: [successEmbed]
        });
    }
};

function hasPermission(member, allowedRoles) {
    if (!allowedRoles || allowedRoles.length === 0) return false;
    return member.roles.cache.some(role => allowedRoles.includes(role.id));
}

function clampEmbedFieldValue(value, maxLen = 1024) {
    const s = (value ?? '').toString();
    if (!s) return 'None';
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}

function clampEmbedDescription(value, maxLen = 4096) {
    const s = (value ?? '').toString();
    if (!s) return 'None';
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}

function clampAuditLogReason(value, maxLen = 512) {
    const s = (value ?? '').toString();
    if (!s) return undefined;
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(0, maxLen - 3)) + '...';
}

function chunkForEmbedField(items, { maxLen = 1024, separator = ' ' } = {}) {
    const parts = Array.isArray(items) ? items.map(v => (v ?? '').toString()).filter(Boolean) : [];
    if (parts.length === 0) return [];
    
    const chunks = [];
    let current = '';
    
    for (const part of parts) {
        const candidate = current ? `${current}${separator}${part}` : part;
        if (candidate.length <= maxLen) {
            current = candidate;
            continue;
        }
        
        if (current) chunks.push(current);
        
        // If a single part itself exceeds maxLen, hard-clamp it into its own chunk.
        if (part.length > maxLen) {
            chunks.push(clampEmbedFieldValue(part, maxLen));
            current = '';
        } else {
            current = part;
        }
    }
    
    if (current) chunks.push(current);
    return chunks;
}
