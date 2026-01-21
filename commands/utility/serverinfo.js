const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Displays information about this server and the bot.'),

  async execute(interaction) {
    const { guild, client } = interaction;


    // Fetch total bans for this guild
    let banCount = 0;
    try {
      const bans = await guild.bans.fetch();
      banCount = bans.size;
    } catch {
      banCount = 'No Permission';
    }

    // Guild Info
    const guildName = guild.name;
    const owner = await guild.fetchOwner();
    const createdAt = `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`;
    const memberCount = guild.memberCount;
    const channels = guild.channels.cache.size;
    const roles = guild.roles.cache.size;

    // Bot Info
    const totalServers = client.guilds.cache.size;
    const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);

    const embed = new EmbedBuilder()
      .setTitle(`📊 Server Info: ${guildName}`)
      .setColor('Blue')
      .setThumbnail(guild.iconURL({ dynamic: true }))
      .addFields(
        { name: '👑 Owner', value: `${owner.user.tag}`, inline: true },
        { name: '📅 Created On', value: `${createdAt}`, inline: true },
        { name: '👥 Members', value: `${memberCount}`, inline: true },
        { name: '📜 Roles', value: `${roles}`, inline: true },
        { name: '📂 Channels', value: `${channels}`, inline: true },
        { name: '🔨 Total Bans', value: `${banCount}`, inline: true },
        { name: '🤖 Bot Servers', value: `${totalServers}`, inline: true },
        { name: '🌍 Total Members Across Servers', value: `${totalMembers}`, inline: true }
      )
      .setFooter({ text: `Requested by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
