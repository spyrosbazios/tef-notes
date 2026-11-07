// A task's reminder should ring at its minute, not whenever Android gets round to it. expo-notifications schedules an
// exact alarm when the app may (AlarmManager.canScheduleExactAlarms) and an inexact one otherwise; on Android 14+
// SCHEDULE_EXACT_ALARM is off until the user grants it, USE_EXACT_ALARM is granted at install. Play restricts that one
// to alarm and calendar apps; this one is sideloaded.
const { AndroidConfig } = require("expo/config-plugins");

module.exports = (config) => AndroidConfig.Permissions.withPermissions(config, ["android.permission.USE_EXACT_ALARM"]);
