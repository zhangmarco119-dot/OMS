# StoreHub 安卓应用

安卓版直接加载部署后的同一套 React 页面，正式地址为 `https://oms-store-management.pages.dev`，测试地址为 `https://oms-store-development.pages.dev`。页面、路由、功能开关、账号权限、Supabase Auth、数据库、Storage 和实时订阅均来自对应网站。没有第二套页面或 Android 数据库，也不需要将数据库密钥嵌入 APK。

正式 APP 与正式网页共用正式数据；测试 APP 与测试网页共用测试数据。两个环境保持隔离，可同时安装。已保存到服务器的操作在另一端刷新或触发现有实时订阅后可见；未提交的本地草稿和登录会话只属于当前设备。APP 需要网络访问。

登录页下方提供当前环境对应的安卓下载入口。正式 APK 地址：`https://oms-store-management.pages.dev/downloads/storehub-production.apk`；测试 APK 地址：`https://oms-store-development.pages.dev/downloads/storehub-development.apk`。`/downloads/android.json` 记录外壳版本和安装包 SHA-256，可用于验证部署后的安装包。Release 构建会将签名后的两种 APK 和校验文件更新到 `public/downloads/`，随网页一起发布。

## 安装和构建

支持 Android 10 及以上，需要可用的 Android System WebView。使用 JDK 17 或更高版本、Android SDK 36。Windows 已安装 Android Studio 时构建脚本会自动选择其 JDK；其他环境配置 `JAVA_HOME` 和 `ANDROID_HOME`。

```powershell
pnpm android:build
pnpm android:check
```

`android:build` 构建测试和正式两个 Debug APK 并执行 Android Lint；输出在 `.tmp/android-artifacts/`。Debug 包仅供调试。`android:check` 需要已启动的模拟器，使用 ADB 和 WebView DevTools 验证真正的安卓页面、原生文件保存、上传选择器、返回键和断网重试。

检查脚本通过本机已登录的 Supabase CLI 获取**测试项目**管理连接（可通过 `SUPABASE_CLI_PATH` 指定 CLI），先读取现有测试账号角色和门店，然后创建临时员工、店长、管理员账号验证真实密码登录。验证货品登记双向保存后，只清理这些临时账号创建的登记和账号。它不读取或更改现有用户的密码，不操作正式数据库。报告和截图在 `test-results/android/`；不保存账号密码、API Key 或登录令牌。Windows 可通过 `ADB_PATH` 指定 ADB。

## 签名与正式安装包

签名密钥必须保存在仓库外并妥善备份。创建不纳入 Git 的 `android/signing.properties`：

```properties
storeFile=C:/Users/your-user/.storehub/android/storehub-release.jks
storePassword=your-local-keystore-password
keyAlias=storehub
keyPassword=your-local-key-password
```

```powershell
pnpm android:release
```

正式 Release 包禁用 WebView 调试，使用本机私有密钥签名。测试和正式应用使用不同包名；同一包名的后续 APK 必须沿用同一密钥，否则无法覆盖安装。安装时允许对应下载应用的“安装未知应用”权限。

## 功能更新与验证

每次网页功能更新仍需同时发布 `v2-development`、`manage-system` 并验证两个站点的 `version.json`。APP 加载同一网站，页面功能与后端变更自动同步，已经打开的页面沿用现有版本检查和“立即更新”机制，不会为更新强行丢弃正在编辑的内容。Android 外壳版本号读取根目录 `package.json`，外壳代码变更需要另外分发新 APK。

新增浏览器 API、上传、下载、图片或导航功能时，必须同时验证 Android WebView。仓库 `AGENTS.md` 已记录此约定。当前原生适配包括：系统返回键、键盘/系统栏避让、相册/文件上传、系统相机拍照、HTTPS 文件下载、Blob 报表导出到系统保存选择器，以及主文档网络失败重试。图片请求失败只由网页现有组件处理，不遮挡页面数据。

下载消息仅允许绑定的 HTTPS 网站顶层页面访问；外部主页面链接交由其他应用打开，禁止明文加载、文件 URL 页面访问和跨来源下载消息。原生 Blob 导出上限为 50MB，超过时显示使用网页版下载的提示。文件保存取消和上传取消不影响当前页面。
