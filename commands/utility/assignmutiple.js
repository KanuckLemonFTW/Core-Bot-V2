const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasRolePermsPermission, getLogChannel } = require('../../utils/role-perms-config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assignmultiple')
    .setDescription('Assign multiple roles to a user.')
    .addUserOption(option =>
      option.setName('user').setDescription('The user to assign roles to').setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role1').setDescription('Role 1').setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role2').setDescription('Role 2').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role3').setDescription('Role 3').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role4').setDescription('Role 4').setRequired(false)
    )
    .addRoleOption(option =>
      option.setName('role5').setDescription('Role 5').setRequired(false)
    ),

  async execute(interaction, client, config) {
    // Check permissions - use per-guild role perms config
    if (!hasRolePermsPermission(interaction.member, interaction.guild.id)) {
      const errorEmbed = new EmbedBuilder()
        .setDescription('❌ You do not have permissions to run this command. This server must be configured with `/setuproleperms`.')
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(user.id);

    // Collect all provided roles
    const roles = [];
    for (let i = 1; i <= 5; i++) {
      const role = interaction.options.getRole(`role${i}`);
      if (role) roles.push(role);
    }

    // Permission hierarchy check for all roles
    const invalidRoles = roles.filter(role => role.position >= interaction.member.roles.highest.position);
    if (invalidRoles.length > 0) {
      const errorEmbed = new EmbedBuilder()
        .setDescription(`❌ You cannot assign roles equal or higher than your highest role: ${invalidRoles.map(r => r.name).join(', ')}`)
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    // Assign all roles in parallel using Promise.allSettled
    const rolePromises = roles.map(role => 
      member.roles.add(role)
        .then(() => ({ status: 'fulfilled', role }))
        .catch(err => ({ status: 'rejected', role, error: err }))
    );

    const results = await Promise.allSettled(rolePromises);

    const successfulRoles = [];
    const failedRoles = [];

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.status === 'fulfilled') {
        successfulRoles.push(result.value.role);
      } else {
        const roleData = result.value || result.reason;
        failedRoles.push(roleData.role);
        console.error('Failed to add role:', roleData.error || result.reason);
      }
    });

    // Create public embed
    let description = '';
    if (successfulRoles.length > 0) {
      description += `✅ Added roles: ${successfulRoles.map(r => `${r}`).join(' ')} to ${user}.\n`;
    }
    if (failedRoles.length > 0) {
      description += `❌ Failed to add: ${failedRoles.map(r => `**${r.name}**`).join(', ')}.`;
    }

    const publicEmbed = new EmbedBuilder()
      .setColor(failedRoles.length > 0 ? 'Orange' : 'Green')
      .setDescription(description);

    await interaction.reply({ embeds: [publicEmbed] });

    // Log to the channel asynchronously (non-blocking)
    // Log to server-specific log channel if configured
    if (successfulRoles.length > 0) {
      const logChannelId = getLogChannel(interaction.guild.id);
      if (logChannelId) {
        client.channels.fetch(logChannelId).then(logChannel => {
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('✅ Multiple Roles Assigned')
              .setColor('Green')
              .addFields(
                { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: false },
                { name: 'Roles', value: successfulRoles.map(r => `${r} (${r.id})`).join('\n'), inline: false },
                { name: 'Assigned By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
              )
              .setTimestamp();

            return logChannel.send({ embeds: [embed] }).catch(() => {});
          }
        }).catch(() => {});
      }
    }
  }
};

