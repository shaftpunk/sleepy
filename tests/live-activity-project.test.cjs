const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const xcode = require('xcode');
const root = path.resolve(__dirname, '..');
const project = xcode.project(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj')); project.parseSync();
const objects = project.hash.project.objects;
const ref = value => typeof value === 'string' ? value : value.value;
const clean = value => typeof value === 'string' ? value.replace(/^"|"$/g, '') : value;
function configurations(target) { return objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations.map(id => objects.XCBuildConfiguration[ref(id)]); }
test('App builds/embeds a real extension target, with shared model and native bridge sources', () => {
  const app = objects.PBXNativeTarget['504EC3031FED79650016851F'], widget = objects.PBXNativeTarget['A74000000000000000000013'];
  assert.equal(clean(widget.productType), 'com.apple.product-type.app-extension');
  const dependency = objects.PBXTargetDependency[ref(app.dependencies[0])]; assert.equal(dependency.target, 'A74000000000000000000013');
  const embed = app.buildPhases.map(ref).map(id => objects.PBXCopyFilesBuildPhase[id]).find(Boolean);
  assert.equal(embed.dstSubfolderSpec, 13);
  const product = objects.PBXBuildFile[ref(embed.files[0])].fileRef; assert.equal(product, widget.productReference);
  const sources = target => objects.PBXSourcesBuildPhase[target.buildPhases.map(ref).find(id => objects.PBXSourcesBuildPhase[id])].files.map(ref).map(id => objects.PBXBuildFile[id].fileRef);
  assert.ok(sources(app).includes('A74000000000000000000002')); assert.ok(sources(widget).includes('A74000000000000000000002'));
  assert.ok(sources(app).includes('A74000000000000000000004'));
  for (const shared of ['A75000000000000000000002', 'A75000000000000000000007']) {
    assert.ok(sources(app).includes(shared)); assert.ok(sources(widget).includes(shared));
  }
  assert.ok(sources(app).includes('A75000000000000000000005'));
  assert.ok(!sources(widget).includes('A75000000000000000000005'), 'credentials and RPC code are app-only');
  for (const config of configurations(widget)) assert.match(clean(config.buildSettings.SWIFT_ACTIVE_COMPILATION_CONDITIONS), /SLEEPY_WIDGET_EXTENSION/);
});
test('both bundle IDs/version settings and Release profiles are target scoped', () => {
  for (const id of ['504EC3031FED79650016851F', 'A74000000000000000000013']) {
    const isApp = id.startsWith('504');
    for (const config of configurations(objects.PBXNativeTarget[id])) {
      const settings = config.buildSettings;
      assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, isApp ? 'no.strandeconsulting.sleepy' : 'no.strandeconsulting.sleepy.widgets');
      assert.equal(Number(settings.MARKETING_VERSION), 1); assert.equal(Number(settings.CURRENT_PROJECT_VERSION), 1);
      assert.equal(settings.CODE_SIGN_ENTITLEMENTS, isApp ? 'App/App.entitlements' : undefined);
      if (config.name === 'Release') assert.equal(clean(settings.PROVISIONING_PROFILE_SPECIFIER), isApp ? '$(SLEEPY_PROVISIONING_PROFILE_SPECIFIER)' : '$(SLEEPY_WIDGET_PROVISIONING_PROFILE_SPECIFIER)');
    }
  }
});
test('new source/resource references resolve and every build phase reference exists', () => {
  for (const [id, file] of Object.entries(objects.PBXFileReference)) {
    if (!/^A7[45]0/.test(id) || typeof file !== 'object' || clean(file.sourceTree) === 'BUILT_PRODUCTS_DIR') continue;
    const base = clean(file.sourceTree) === 'SOURCE_ROOT' ? 'ios/App' : ['SleepLiveActivity.swift','PrivacyInfo.xcprivacy','../../LiveActivityCore/Sources/LiveActivityCore/SleepActivityPolicy.swift'].includes(file.path) ? 'ios/App/App' : 'ios/App/SleepyWidgets';
    assert.ok(fs.existsSync(path.join(root, base, clean(file.path))), file.path);
  }
  for (const section of ['PBXSourcesBuildPhase', 'PBXResourcesBuildPhase', 'PBXCopyFilesBuildPhase']) {
    for (const entry of Object.values(objects[section])) if (entry?.files) for (const item of entry.files) assert.ok(objects.PBXBuildFile[ref(item)]);
  }
});
test('App capabilities remain present; extension only declares WidgetKit and native localization keys agree', () => {
  const plist = require('plist');
  const read = file => plist.parse(fs.readFileSync(path.join(root,file),'utf8'));
  const app = read('ios/App/App/Info.plist'), widget = read('ios/App/SleepyWidgets/Info.plist');
  assert.equal(app.NSSupportsLiveActivities, true); assert.deepEqual(app.UIBackgroundModes, ['audio']);
  assert.ok(app.NSMicrophoneUsageDescription); assert.ok(app.CFBundleURLTypes.some(type=>type.CFBundleURLSchemes.includes('sleepy')));
  assert.deepEqual(read('ios/App/App/App.entitlements'), { 'aps-environment': 'production', 'com.apple.developer.applesignin': ['Default'] });
  assert.equal(widget.NSExtension.NSExtensionPointIdentifier, 'com.apple.widgetkit-extension');
  const privacy=read('ios/App/App/PrivacyInfo.xcprivacy');
  assert.deepEqual(privacy.NSPrivacyAccessedAPITypes,[{NSPrivacyAccessedAPIType:'NSPrivacyAccessedAPICategoryUserDefaults',NSPrivacyAccessedAPITypeReasons:['CA92.1']}]);
  const keys = lang => [...fs.readFileSync(path.join(root,`ios/App/SleepyWidgets/${lang}.lproj/Localizable.strings`),'utf8').matchAll(/^"([^"]+)"\s*=/gm)].map(match=>match[1]).sort();
  assert.deepEqual(keys('en'),keys('nb'));
  for (const key of ['wake_sleep','estimated_progress','estimated_wake','estimated_time_left','wake_auth','wake_unconfirmed']) assert.ok(keys('en').includes(key));
  assert.match(fs.readFileSync(path.join(root,'ios/App/SleepyWidgets/en.lproj/Localizable.strings'),'utf8'), /"wake_sleep" = "Wake up";/);
  assert.match(fs.readFileSync(path.join(root,'ios/App/SleepyWidgets/nb.lproj/Localizable.strings'),'utf8'), /"wake_sleep" = "Våkn opp";/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'capacitor.config.json'),'utf8')).ios.loggingBehavior,'none');
});
test('Capacitor deployment scanning still sees the App minimum before the extension minimum', () => {
  const file=fs.readFileSync(path.join(root,'ios/App/App.xcodeproj/project.pbxproj'),'utf8');
  assert.equal(file.match(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+)/)[1],'15.0');
  for(const config of configurations(objects.PBXNativeTarget['A74000000000000000000013']))assert.equal(Number(config.buildSettings.IPHONEOS_DEPLOYMENT_TARGET),16.2);
});
