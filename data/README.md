# Discord Moderation Bot

A comprehensive Discord moderation bot with global ban functionality, role management, automatic protection systems, and utility commands.

## Quick Setup Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Create `.env` File
Create a `.env` file in the root directory:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
MAIN_SERVER_ID=your_main_server_id_here
OwnerID=your_discord_user_id_here
```

### 3. Configure `config.json`
Edit `config.json` and add your:
- **Role IDs** for permissions
- **Channel IDs** for logging
- **Role IDs** for unverified, verified, blacklist, and autorole

### 4. Get Bot Token & Client ID
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section → Copy token → Enable "Message Content Intent" and "Server Members Intent"
4. Go to "General Information" → Copy Application ID (Client ID)

### 5. Invite Bot to Server
Use this URL (replace `CLIENT_ID` with your bot's client ID):
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

### 6. Deploy Commands (Optional)
```bash
node deploy-commands.js
```

### 7. Run the Bot
```bash
node index.js
```

---

## All Commands

### Global Commands
Commands that affect users across all servers where the bot is present.

#### `/globalban [user] [reason]`
- **Description**: Globally ban a user from all servers
- **Permissions**: `globalBan` role
- **Features**: 
  - Confirmation button before execution
  - Sends DM to user before banning
  - Creates case number (PNET-####)
  - Logs with approve/deny/escalate/remind buttons
  - Auto-creates proof request thread

#### `/globalunban [user] [reason] [casenumber]`
- **Description**: Globally unban a user from all servers
- **Permissions**: `globalBan` role
- **Features**: 
  - Can use case number to find user
  - Shows original ban case ID
  - Confirmation button before execution
  - Logs with approve/deny buttons

#### `/globaltimeout [user] [duration] [reason]`
- **Description**: Timeout a user across all servers
- **Permissions**: `globaltimeout` role
- **Options**: 
  - `duration`: Duration in minutes (required)
  - `reason`: Reason for timeout (optional)

#### `/globalrolestripe [user] [reason]`
- **Description**: Remove all roles from a user across all servers
- **Permissions**: `rolePerms` role
- **Features**: 
  - Creates case number
  - Backs up roles before removal
  - Logs the action

#### `/globalunrolestripe [user]`
- **Description**: Restore roles to a user across all servers
- **Permissions**: `rolePerms` role
- **Features**: 
  - Restores roles from backup if available
  - Logs the action

#### `/bansync [main_server_id]`
- **Description**: Sync bans from main server to all other servers
- **Permissions**: `bansync` role
- **Options**: 
  - `main_server_id`: Server ID to sync from (optional, defaults to current guild)

---

### Moderation Commands
Server-specific moderation commands. Requires `/setupmoderation` to be configured per server.

#### `/mute [user] [duration] [reason]`
- **Description**: Timeout a user (server-specific only)
- **Permissions**: Configured via `/setupmoderation`
- **Options**: 
  - `duration`: Duration format (e.g., 1h, 30m, 1d)
  - `reason`: Reason for timeout (optional)
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/unmute [user]`
- **Description**: Remove timeout from a user
- **Permissions**: Configured via `/setupmoderation`
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/warn [user] [reason]`
- **Description**: Warn a user
- **Permissions**: Configured via `/setupmoderation`
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/purge [count] [user]`
- **Description**: Delete messages (1-100, optionally filtered by user)
- **Permissions**: Configured via `/setupmoderation`
- **Options**: 
  - `count`: Number of messages to delete (1-100, required)
  - `user`: Only delete messages from this user (optional)
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/blacklist [user] [reason]`
- **Description**: Blacklist a user (remove all roles, add blacklist role)
- **Permissions**: `blacklist` role
- **Features**: 
  - Confirmation button before execution
  - Creates case number (CASE-####)
  - Logs with approve/deny/escalate/remind buttons
  - Removes all roles and adds blacklist role

#### `/unblacklist [user] [reason] [casenumber]`
- **Description**: Unblacklist a user (restore verified role)
- **Permissions**: `blacklist` role
- **Features**: 
  - Can use case number to find user
  - Shows original blacklist case ID
  - Confirmation button before execution
  - Logs with approve/deny buttons

#### `/forceverify [user]`
- **Description**: Force verify a user (remove unverified role, add verified role)
- **Permissions**: `forceverify` role
- **Features**: 
  - Removes unverified role
  - Adds verified role

#### `/punishmentlookup [user]`
- **Description**: Look up all punishments for a user across all servers
- **Permissions**: Anyone can use
- **Features**: 
  - Shows warnings, timeouts, blacklists, global bans, role strips
  - Displays case numbers and timestamps
  - Auto-clears punishments after 14 days

#### `/removepunishment [user] [caseid]`
- **Description**: Remove a punishment case from a user's record
- **Permissions**: `removePunishment` role
- **Options**: 
  - `caseid`: Case ID to remove (e.g., CASE-0001, PNET-0002)
- **Features**: 
  - Logs removal to dedicated channel
  - Removes case from database

---

### Setup Commands
Commands to configure the bot for your server.

#### `/setupmoderation [role] [logchannel]`
- **Description**: Configure moderation roles and log channels for this server
- **Permissions**: Server owner or user with `ownership` role
- **Options**: 
  - `role`: Role that can use moderation commands
  - `logchannel`: Channel where moderation logs are sent
- **Affects**: `/mute`, `/unmute`, `/warn`, `/purge`

#### `/setuproleperms [role] [logchannel]`
- **Description**: Configure roles and log channels for assign/unassign commands
- **Permissions**: Server owner or user with `ownership` role
- **Options**: 
  - `role`: Role that can use assign/unassign commands
  - `logchannel`: Channel where role assignment logs are sent
- **Affects**: `/assignrole`, `/unassignrole`, `/assignmultiple`, `/unassignmultiple`, `/temprole`

#### `/setuprequestrole [channel] [approver1] [approver2] [approver3] [logchannel]`
- **Description**: Configure role request system for this server
- **Permissions**: Server owner or user with `ownership` role
- **Options**: 
  - `channel`: Channel where role requests are sent
  - `approver1/2/3`: Roles that can approve/deny requests
  - `logchannel`: Channel for role request logs (optional)

---

### Role Management Commands
Commands for managing user roles. Requires `/setuproleperms` to be configured.

#### `/assignrole [user] [role]`
- **Description**: Assign a single role to a user
- **Permissions**: Configured via `/setuproleperms`
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/unassignrole [user] [role]`
- **Description**: Remove a single role from a user
- **Permissions**: Configured via `/setuproleperms`
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/assignmultiple [user] [role1] [role2] [role3] [role4] [role5]`
- **Description**: Assign multiple roles to a user (up to 5)
- **Permissions**: Configured via `/setuproleperms`
- **Options**: 
  - `role1`: Required
  - `role2-5`: Optional
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/unassignmultiple [user] [role1] [role2] [role3] [role4] [role5]`
- **Description**: Remove multiple roles from a user (up to 5)
- **Permissions**: Configured via `/setuproleperms`
- **Options**: 
  - `role1`: Required
  - `role2-5`: Optional
- **Features**: 
  - Creates case number
  - Logs to server-specific log channel

#### `/temprole [user] [role] [action] [time]`
- **Description**: Manage temporary roles for a user
- **Permissions**: Configured via `/setuproleperms`
- **Options**: 
  - `action`: `add`, `remove`, or `status`
  - `time`: Duration for adding (e.g., 1h, 30m, 1d) - required for `add`
- **Features**: 
  - Automatically removes role after duration expires
  - Cleanup runs every 10 seconds
  - Handles offline time (cleans up expired roles on startup)
  - Logs to server-specific log channel

#### `/requestrole [role]`
- **Description**: Request a role to be added to you
- **Permissions**: Anyone can use
- **Features**: 
  - Prevents requesting roles you already have
  - Sends request to configured channel
  - Staff can approve/deny with buttons
  - Logs to server-specific log channel

#### `/apirestore [user]`
- **Description**: Restore roles for a previously kicked/banned user
- **Permissions**: `ownership` role
- **Features**: 
  - Uses newest role backup
  - Backups expire after 24 hours
  - Automatically filters out deleted roles

---

### Utility Commands
General utility commands for information and server management.

#### `/serverinfo`
- **Description**: Displays information about the server and bot statistics
- **Permissions**: Anyone can use
- **Shows**: 
  - Server name, owner, creation date
  - Member count, channels, roles
  - Bot uptime, total servers, total users

#### `/userinfo [target]`
- **Description**: Displays information about a user
- **Permissions**: Anyone can use
- **Shows**: 
  - User ID, bot status
  - Account creation date
  - Server join date
  - Roles list

---

## Automatic Features

### Role Backup System
- Automatically backs up user roles when they're:
  - Banned
  - Kicked
  - Leave the server
- **Storage**: Newest backup only (old backups are deleted)
- **Expiration**: 24 hours
- **Usage**: Used by `/apirestore` command

### Welcome Messages
- Automatically sends welcome messages when users join
- Configurable message, channel, title, and image
- Supports placeholders: `{user}`, `{ticketChannel}`

### Autorole
- Automatically assigns a role to new members
- Configured in `config.json` under `roles.autorole`

### Bot Protection
- Automatically kicks unauthorized bots added to the server
- Checks if the person adding the bot is in the authorized users list
- Logs both authorized and unauthorized bot additions

### Alt Detection
- Automatically detects accounts below the configured minimum age
- Sends logs to the alt detection channel with approve/deny buttons
- If denied, user is blacklisted automatically

### Temporary Role Cleanup
- Automatically removes expired temporary roles
- Runs every 10 seconds
- Cleans up roles that expired while the bot was offline

### Punishment Auto-Cleanup
- Automatically removes punishment records after 14 days
- Applies to: warnings, timeouts, blacklists, global bans, role strips

---

## Permissions

The bot uses role-based permissions configured in `config.json`. Users must have one of the specified role IDs to use certain commands:

- **blacklist**: Can use `/blacklist` and `/unblacklist`
- **globalBan**: Can use `/globalban` and `/globalunban`
- **rolePerms**: Can use `/globalrolestripe` and `/globalunrolestripe`
- **globaltimeout**: Can use `/globaltimeout`
- **bansync**: Can use `/bansync`
- **forceverify**: Can use `/forceverify`
- **ownership**: Can use `/apirestore` and configure server settings
- **removePunishment**: Can use `/removepunishment`

**Note**: Moderation commands (`/mute`, `/unmute`, `/warn`, `/purge`) and role assignment commands (`/assignrole`, `/unassignrole`, etc.) require per-server configuration using `/setupmoderation` and `/setuproleperms` respectively.

---

## Case Number System

The bot generates unique case numbers for tracking actions:

- **PNET-####**: Global bans (e.g., PNET-0001)
- **CASE-####**: Blacklists (e.g., CASE-0001)

Case numbers are sequential and can be used with `/globalunban` and `/unblacklist` to find users.

---

## Configuration Files

### `config.json`
Main configuration file containing:
- **permissions**: Role IDs for different permission levels
- **channels**: Channel IDs for logging
- **roles**: Role IDs for unverified, verified, blacklist, and autorole
- **settings**: General bot settings (sendDMs, logAllActions, etc.)
- **welcome**: Welcome message configuration
- **botProtection**: Authorized users who can add bots
- **altDetection**: Minimum account age and log channel

### Data Files (Auto-Generated)
- `data/roleRequests.json`: Role request configurations per guild
- `data/moderation_config.json`: Moderation role and log channel configs per guild
- `data/role_perms_config.json`: Role permission configs per guild
- `data/case_database.json`: Case records for all actions
- `data/temp_roles.json`: Temporary role data
- `role_database.json`: Role backups (expires after 24 hours)

---

## Troubleshooting

- **Commands not appearing**: Make sure the bot has `applications.commands` scope and wait a few minutes for Discord to update
- **Permission errors**: Check that role IDs in `config.json` are correct
- **Channel not found**: Verify channel IDs in `config.json` exist in your server
- **DM errors**: Users may have DMs disabled - this is normal and logged silently
- **Role backup not found**: Backups expire after 24 hours by default
- **Moderation commands not working**: Run `/setupmoderation` in your server first
- **Role assignment commands not working**: Run `/setuproleperms` in your server first

---

## File Structure

```
Main Bot/
├── commands/
│   ├── global/          # Global commands (affect all servers)
│   ├── moderator/       # Moderation commands
│   ├── moderation/      # Setup commands
│   └── utility/         # Utility commands
├── data/                # Data files (auto-generated)
├── utils/               # Utility functions
├── index.js             # Main bot file
├── deploy-commands.js   # Command deployment script
├── config.json          # Bot configuration
├── .env                 # Environment variables (not in repo)
└── role_database.json   # Role backup database (not in repo)
```

---

## Notes

- The bot requires proper permissions in each server
- Make sure to configure all channel and role IDs in `config.json`
- Role backups are stored locally and expire after 24 hours
- DMs are sent when enabled in settings (users must have DMs enabled from server members)
- Escalated bans/blacklists can only be reversed by users with ownership permission
- Alt detection requires blacklist permissions to approve/deny
- Bot protection requires authorized user IDs to be configured
- Temporary roles are automatically cleaned up every 10 seconds
- Punishment records are automatically cleared after 14 days
