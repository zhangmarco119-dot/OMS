export interface SystemRelease {
  date: string;
  highlights: string[];
  title: string;
  version: string;
}

// 每次升级必须在数组顶部新增一条中文更新记录；登录页和“关于系统”会自动使用第一条版本号。
export const systemReleaseHistory: SystemRelease[] = [
  {
    date: '2026-07-14',
    highlights: [
      '员工 SOP 手册改为仅显示产品名称的条目列表，支持搜索和分类筛选。',
      'SOP 详情按“一张图片＋一段步骤文字”拼接为一个连续页面。',
      '管理员可创建 SOP 分类，并通过 Excel 清单配合图片文件批量导入 SOP 草稿。',
    ],
    title: '重构 SOP 手册与批量导入',
    version: 'StoreHub v2.1.9',
  },
  {
    date: '2026-07-14',
    highlights: [
      '修复 SOP 未填生效时间时无法立即发布的数据库约束冲突。',
      '修复已发布 SOP 再编辑和归档时的同类生命周期问题。',
      '前端错误反馈现在会明确区分保存、图片上传和发布失败。',
    ],
    title: '修复 SOP 保存与发布流程',
    version: 'StoreHub v2.1.8',
  },
  {
    date: '2026-07-14',
    highlights: [
      '建立开发测试与正式 Supabase 的分支级强制隔离，配置错误时阻止构建和部署。',
      '新增 Migration、RLS、远端版本、测试与构建的一体化发布门禁。',
      '将测试 Seed 限定为开发环境专用，并规范开发先迁移、正式后发布的顺序。',
    ],
    title: '建立双数据库环境隔离流程',
    version: 'StoreHub v2.1.7',
  },
  {
    date: '2026-07-14',
    highlights: [
      '将“关于系统”入口调整为仅管理员账号可见。',
      '为关于系统页面增加管理员路由保护，员工和店长无法访问。',
    ],
    title: '限制系统信息为管理员专用',
    version: 'StoreHub v2.1.6',
  },
  {
    date: '2026-07-14',
    highlights: [
      '在“我的”菜单新增“关于系统”入口。',
      '新增系统版本与历次更新内容页面。',
      '版本号改为从最新更新记录自动生成，后续升级必须同步填写中文更新摘要。',
    ],
    title: '新增关于系统与版本记录',
    version: 'StoreHub v2.1.5',
  },
  {
    date: '2026-07-13',
    highlights: [
      '统一弹窗、底部抽屉、成功提示和固定操作栏的安全区规则。',
      '修复到货确认、历史明细、商品操作、任务提醒等窗口被底部导航遮挡的问题。',
    ],
    title: '全面修复弹窗与底部导航遮挡',
    version: 'StoreHub v2.1.4',
  },
  {
    date: '2026-07-13',
    highlights: [
      '账号修改保存成功后增加中文确认弹窗。',
      '新建账号和普通账号移除邮箱条目，仅保留初始管理员邮箱维护能力。',
    ],
    title: '简化账号资料管理',
    version: 'StoreHub v2.1.3',
  },
  {
    date: '2026-07-13',
    highlights: [
      '修复新建任务模板和新建公告无法滚动到底部的问题。',
      '统一全屏编辑页滚动区域、固定操作栏和手机安全区。',
    ],
    title: '修复管理编辑页底部操作',
    version: 'StoreHub v2.1.2',
  },
  {
    date: '2026-07-13',
    highlights: [
      '重构食品制作类 SOP 编辑器，改为图片优先的编辑流程。',
      '支持未保存图片即时预览、多图管理以及安全区发布操作栏。',
    ],
    title: '重构食品制作 SOP',
    version: 'StoreHub v2.1.1',
  },
  {
    date: '2026-07-13',
    highlights: [
      '完成全系统 UI/UX 专业化改造，统一颜色、卡片、表单、反馈与导航。',
      '保持员工、店长和管理员原有业务能力及权限边界。',
    ],
    title: '全系统 UI/UX 专业化改造',
    version: 'StoreHub v2.1.0',
  },
];

export const systemVersion = systemReleaseHistory[0].version;
