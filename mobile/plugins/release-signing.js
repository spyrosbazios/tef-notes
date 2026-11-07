// Signs the release APK with your own keystore when TEF_NOTES_KEYSTORE names one (a file path), and with the generated
// project's debug keystore when it does not, so a fork with no secrets still builds. Read from the environment at Gradle
// time: TEF_NOTES_KEYSTORE, TEF_NOTES_KEYSTORE_PASSWORD, TEF_NOTES_KEY_ALIAS, TEF_NOTES_KEY_PASSWORD. The release workflow
// (.github/workflows/release.yml) sets them from its secrets. Patches the generated app/build.gradle, so it survives
// `expo prebuild`; it throws when the template no longer has the lines it anchors on.
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING = `signingConfigs {
        if (System.getenv("TEF_NOTES_KEYSTORE")) {
            release {
                storeFile file(System.getenv("TEF_NOTES_KEYSTORE"))
                storePassword System.getenv("TEF_NOTES_KEYSTORE_PASSWORD")
                keyAlias System.getenv("TEF_NOTES_KEY_ALIAS")
                keyPassword System.getenv("TEF_NOTES_KEY_PASSWORD")
            }
        }`;
const RELEASE = `signingConfig System.getenv("TEF_NOTES_KEYSTORE") ? signingConfigs.release : signingConfigs.debug
            def enableShrinkResources`;

function replaceOnce(text, from, to) {
  if (!text.includes(from)) throw new Error(`release-signing: app/build.gradle has no "${from.split("\n")[0]}" to patch`);
  return text.replace(from, () => to);
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    let gradle = c.modResults.contents;
    gradle = replaceOnce(gradle, "signingConfigs {", SIGNING);
    gradle = replaceOnce(gradle, "signingConfig signingConfigs.debug\n            def enableShrinkResources", RELEASE);
    c.modResults.contents = gradle;
    return c;
  });
