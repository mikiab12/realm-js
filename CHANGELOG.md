x.x.x Release notes (yyyy-MM-dd)
=============================================================
### Breaking changes
* None

### Enhancements
* Support for queries comparing optional properties to `null`
* `object.isValid()` has been added to enable checking if an object has been deleted
  - **Note:** Custom object classes can extend `Realm.Object` to inherit this method
* Support opening a Realm as read-only with the `readOnly` configuration option
* Support for providing a custom migration function (please see the docs for details)
* Added `path`, `readOnly`, `schema`, and `schemaVersion` properties to `Realm` instances
* Optional and list properties are no longer required when creating objects

### Bugfixes
* When accessing an empty Results `undefined` is returned rather than throwing an exception
* Accessing a deleted object throws a JS exception rather than crashing
* Accessing an invalidated Results snapshot throws a JS exception rather than crashing
* Fix for error message when specifying properties with invalid object types
* Fix memory leak when reloading an app in debug mode

0.11.1 Release notes (2016-3-29)
=============================================================
### Bugfixes
* Fix for using Android Studio to build app using Realm
* Fix for sharing Realm between JS and Objective-C/Swift

0.11.0 Release notes (2016-3-24)
=============================================================
### Breaking changes
* Realm for React Native is now packaged as a static library for iOS
  - Remove the reference to `RealmJS.xcodeproj` from your Xcode project
    (under the `Libraries` group)
  - Make sure `rnpm` is installed and up-to-date: `npm install -g rnpm`
  - Run `rnpm link realm` from your app's root directory

### Enhancements
* Support for encrypted Realms
* List and Results now inherit from Realm.Collection
* List and Results is now iterable (e.g. supports `for...of` loops)
* Add common Array methods to List and Results
* Accept constructor in create() and objects() methods
* Support relative paths when opening Realms
* Support case insensitive queries by adding `[c]` after operators
* Support for indexed `bool`, `string`, and `int` properties
* Added `Realm.schemaVersion` method, which supports unopened Realms

### Bugfixes
* Fix for crash on Android when initializing the Realm module
* Fix for using Chrome debug mode from a device
* Fix for List splice method not accepting a single argument
* Don't download or unpack core libraries unnecessarily


0.10.0 Release notes (2016-2-22)
=============================================================
### Enhancements
* Initial Release