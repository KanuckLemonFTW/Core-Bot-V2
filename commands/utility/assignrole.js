const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { hasRolePermsPermission, getLogChannel } = require('../../utils/role-perms-config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assignrole')
    .setDescription('Assign a role to a user.')
    .addUserOption(option =>
      option.setName('user').setDescription('The user to assign the role to').setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role').setDescription('The role to assign').setRequired(true)
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
    const role = interaction.options.getRole('role');
    const member = await interaction.guild.members.fetch(user.id);

    // Permission hierarchy check
    if (role.position >= interaction.member.roles.highest.position) {
      const errorEmbed = new EmbedBuilder()
        .setDescription('❌ You cannot assign a role equal or higher than your highest role.')
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    await member.roles.add(role).catch(err => {
      console.error(err);
      const errorEmbed = new EmbedBuilder()
        .setDescription('❌ Failed to assign the role.')
        .setColor('#FF0000');
      
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    });

    // ✅ Create the public embed
    const publicEmbed = new EmbedBuilder()
      .setColor('Green')
      .setDescription(`✅ Added role ${role} to ${user}.`);

    await interaction.reply({ embeds: [publicEmbed] });

    // Log to server-specific log channel if configured
    const logChannelId = getLogChannel(interaction.guild.id);
    if (logChannelId) {
      client.channels.fetch(logChannelId).then(logChannel => {
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle('✅ Role Assigned')
            .setColor('Green')
            .addFields(
              { name: 'User', value: `<@${user.id}> (${user.tag})`, inline: false },
              { name: 'Role', value: `${role} (${role.id})`, inline: false },
              { name: 'Assigned By', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: false },
            )
            .setTimestamp();

          return logChannel.send({ embeds: [embed] }).catch(() => {});
        }
      }).catch(() => {});
    }
  }
};
