import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SopBatchImportProgress } from '../features/content/sopBatchImport';
import { formatSopActionError } from '../features/content/sopFeedback';
import { createEmptyNoticeDraft, createEmptySopDraft } from '../services/v2-content.service';
import { NoticeEditor, SopArchiveManager, SopBatchImporter, SopBatchOperationsMenu, SopCategoryManager, SopEditor } from './AdminContentPage';

const sopWorkbookFile = (rows: Array<Record<string, unknown>>, name = 'sops.xlsx') => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'SOP');
  return new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

describe('SopEditor image-first workflow', () => {
  const createObjectUrl = vi.fn(() => 'blob:sop-preview');
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('previews and uploads a selected image immediately before saving the SOP form', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onUploadImage = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), title: '芒果酸奶碗' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={onSave}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={onUploadImage}
      status="new"
    />);

    expect(screen.getByRole('dialog', { name: '新建制作流程' })).toHaveClass('h-[100dvh]', 'z-50');
    expect(screen.getByRole('button', { name: '保存并预览' }).closest('.safe-bottom')).toHaveClass('fixed', 'z-[60]');

    const file = new File(['image'], 'finished-bowl.png', { type: 'image/png' });
    const input = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image/png"]')).find((entry) => entry.multiple);
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    expect((await screen.findAllByAltText('finished-bowl.png'))[0]).toHaveAttribute('src', 'blob:sop-preview');
    expect(await screen.findByText('将在保存时上传')).toBeInTheDocument();
    expect(onUploadImage).not.toHaveBeenCalled();
    expect(screen.getByText('上传附件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      existingSteps: [],
      pendingAssets: [expect.objectContaining({ assetKind: 'step', file })],
    })));
  });

  it('stages and saves a pure-text step without requiring an image', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<SopEditor
      busy={false}
      categories={['通用']}
      draft={{ ...createEmptySopDraft(['store-1']), category: '通用', title: '纯文字流程' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={onSave}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="new"
    />);

    fireEvent.click(screen.getByRole('button', { name: '添加纯文字步骤' }));
    fireEvent.change(screen.getByPlaceholderText('无图片时必须填写；有图片时可留空'), { target: { value: '静置十分钟后检查状态。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      pendingAssets: [expect.objectContaining({ assetKind: 'step', file: null, stepText: '静置十分钟后检查状态。' })],
    })));
  });

  it('publishes a mixed pure-text and pure-image SOP without inventing missing content', async () => {
    const onPublish = vi.fn().mockResolvedValue(true);
    const base = { asset_kind: 'step', bucket: 'v2-sop-assets', created_at: '2026-07-14T00:00:00Z', size_bytes: 0, sop_id: 'sop-1', uploaded_by: 'admin-1' };
    const textStep = { ...base, file_name: null, id: 'text-step', mime_type: null, object_path: null, signedUrl: null, sort_order: 0, step_text: '纯文字说明' };
    const imageStep = { ...base, file_name: 'only-image.jpg', id: 'image-step', mime_type: 'image/jpeg', object_path: 'sop-1/only-image.jpg', signedUrl: 'https://example.test/only-image.jpg', size_bytes: 100, sort_order: 1, step_text: '' };
    render(<SopEditor
      busy={false}
      categories={['通用']}
      draft={{ ...createEmptySopDraft(['store-1']), category: '通用', id: 'sop-1', title: '混合步骤流程' }}
      errorMessage={null}
      existingAssets={[textStep, imageStep] as never}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={onPublish}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="draft"
    />);

    expect(screen.getByText('纯文字步骤')).toBeInTheDocument();
    expect(screen.getByAltText('only-image.jpg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存并预览' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalled());
  });

  it('allows images and attachments before required fields, then validates in a Chinese dialog on save', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onUploadImage = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), category: '' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={onSave}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={onUploadImage}
      status="new"
    />);

    const imageInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image/png"]')).find((entry) => entry.multiple);
    fireEvent.change(imageInput!, { target: { files: [new File(['image'], 'first.png', { type: 'image/png' })] } });
    expect(await screen.findByText('将在保存时上传')).toBeInTheDocument();
    expect(screen.getByAltText('first.png')).toHaveAttribute('src', 'blob:sop-preview');
    expect(onUploadImage).not.toHaveBeenCalled();

    const attachmentInput = container.querySelector<HTMLInputElement>('input[type="file"][accept="application/pdf"]');
    fireEvent.change(attachmentInput!, { target: { files: [new File(['pdf'], 'recipe.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText('recipe.pdf（待上传）')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(await screen.findByRole('dialog', { name: '请完善 SOP 信息' })).toHaveTextContent('请填写产品或流程名称');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the local preview and offers retry when an SOP image upload fails', async () => {
    const onUploadImage = vi.fn().mockRejectedValue(new Error('网络暂时不可用'));
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), id: 'sop-1', title: '草莓酸奶碗' }}
      errorMessage={null}
      existingAssets={[]}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={onUploadImage}
      status="new"
    />);

    const file = new File(['image'], 'failed.png', { type: 'image/png' });
    const stepInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"][accept*="image/png"]')).find((entry) => entry.multiple);
    fireEvent.change(stepInput!, { target: { files: [file] } });

    expect(await screen.findByText('网络暂时不可用')).toBeInTheDocument();
    expect(screen.getByAltText('failed.png')).toHaveAttribute('src', 'blob:sop-preview');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('shows two compact columns and moves a step through its sequence dropdown', async () => {
    const onReorderImages = vi.fn().mockResolvedValue(undefined);
    const onPublish = vi.fn().mockResolvedValue(true);
    const asset = (id: string, name: string, sortOrder: number) => ({
      asset_kind: 'step', bucket: 'v2-sop-assets', created_at: '2026-07-14T00:00:00Z', file_name: name, id,
      mime_type: 'image/jpeg', object_path: `sop-1/${name}`, signedUrl: `https://example.test/${name}`,
      size_bytes: 100, sop_id: 'sop-1', sort_order: sortOrder, step_text: `${name}说明`, uploaded_by: 'admin-1',
    });
    render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), id: 'sop-1', title: '双图步骤' }}
      errorMessage={null}
      existingAssets={[asset('image-1', '第一步.jpg', 0), asset('image-2', '第二步.jpg', 1)] as never}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={onPublish}
      onReorderImages={onReorderImages}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="draft"
    />);

    const grid = screen.getByTestId('sop-step-grid');
    expect(grid).toHaveClass('grid-cols-2');
    const firstDescription = screen.getByDisplayValue('第一步.jpg说明');
    const firstImage = screen.getByAltText('第一步.jpg');
    expect(firstDescription.compareDocumentPosition(firstImage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const orderSelect = screen.getByRole('combobox', { name: '调整 第二步.jpg 的步骤序号' });
    expect(orderSelect).toHaveClass('min-h-8', 'w-full');
    expect(orderSelect.parentElement).toHaveClass('space-y-1.5');
    expect(orderSelect.nextElementSibling).toHaveClass('grid-cols-2');
    expect(screen.getAllByText('替换')[0].closest('label')).toHaveClass('min-h-8');
    expect(screen.getByRole('button', { name: '删除 第一步.jpg' })).toHaveClass('min-h-8');
    expect(screen.getAllByText('替换')).toHaveLength(2);
    expect(screen.getAllByText('删除')).toHaveLength(2);
    expect(screen.queryByRole('combobox', { name: '关联任务模板' })).not.toBeInTheDocument();
    expect(screen.getByText('上传附件')).toBeInTheDocument();
    fireEvent.change(orderSelect, { target: { value: '0' } });

    await waitFor(() => expect(onReorderImages).toHaveBeenCalledWith(['image-2', 'image-1']));
    expect(within(grid).getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual(['第二步.jpg', '第一步.jpg']);
    expect(screen.queryByRole('checkbox', { name: /静默发布/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存并预览' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ existingSteps: expect.any(Array) })));
  });

  it('keeps a product cover separate from production steps and uploads its replacement immediately', async () => {
    let finishUpload: (() => void) | undefined;
    const onUploadCover = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishUpload = resolve; }));
    const cover = {
      asset_kind: 'cover', bucket: 'v2-sop-assets', created_at: '2026-07-14T00:00:00Z', file_name: '产品图.jpg', id: 'cover-1',
      mime_type: 'image/jpeg', object_path: 'sop-1/cover.jpg', signedUrl: 'https://example.test/cover.jpg', size_bytes: 100,
      sop_id: 'sop-1', sort_order: 0, step_text: '', uploaded_by: 'admin-1',
    };
    const { container } = render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), category: '酸奶碗制作', id: 'sop-1', title: '产品图测试' }}
      errorMessage={null}
      existingAssets={[cover] as never}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={vi.fn().mockResolvedValue(undefined)}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={onUploadCover}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="draft"
    />);

    expect(screen.getByAltText('产品图测试 产品图')).toHaveAttribute('src', 'https://example.test/cover.jpg');
    expect(screen.queryByTestId('sop-step-grid')).not.toBeInTheDocument();
    const productInput = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
      .find((input) => input.accept.includes('image/png') && !input.multiple);
    expect(productInput).toBeDefined();
    const replacement = new File(['image'], '新产品图.png', { type: 'image/png' });
    fireEvent.change(productInput!, { target: { files: [replacement] } });

    expect(await screen.findByAltText('本地参考图待上传预览')).toHaveAttribute('src', 'blob:sop-preview');
    expect(onUploadCover).toHaveBeenCalledWith(replacement, expect.any(Function));
    finishUpload?.();
    await waitFor(() => expect(screen.queryByAltText('本地参考图待上传预览')).not.toBeInTheDocument());
  });

  it('replaces an existing step image with an immediate local preview', async () => {
    let finishReplace: (() => void) | undefined;
    const onReplaceImage = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finishReplace = resolve; }));
    const asset = {
      asset_kind: 'step', bucket: 'v2-sop-assets', created_at: '2026-07-14T00:00:00Z', file_name: '原图片.jpg', id: 'step-1',
      mime_type: 'image/jpeg', object_path: 'sop-1/original.jpg', signedUrl: 'https://example.test/original.jpg', size_bytes: 100,
      sop_id: 'sop-1', sort_order: 0, step_text: '原步骤说明', uploaded_by: 'admin-1',
    };
    render(<SopEditor
      busy={false}
      categories={['酸奶碗制作']}
      draft={{ ...createEmptySopDraft(['store-1']), category: '酸奶碗制作', id: 'sop-1', title: '替换图片测试' }}
      errorMessage={null}
      existingAssets={[asset] as never}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onDeleteAsset={vi.fn().mockResolvedValue(undefined)}
      onPublish={vi.fn().mockResolvedValue(true)}
      onReorderImages={vi.fn().mockResolvedValue(undefined)}
      onReplaceImage={onReplaceImage}
      onSave={vi.fn().mockResolvedValue(true)}
      onUploadCover={vi.fn().mockResolvedValue(undefined)}
      onUploadImage={vi.fn().mockResolvedValue(undefined)}
      status="draft"
    />);

    const replacement = new File(['replacement'], '新图片.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('替换 原图片.jpg'), { target: { files: [replacement] } });

    expect(await screen.findByAltText('原图片.jpg 替换预览')).toHaveAttribute('src', 'blob:sop-preview');
    expect(onReplaceImage).toHaveBeenCalledWith(asset, replacement, '原步骤说明', expect.any(Function));
    finishReplace?.();
    await waitFor(() => expect(screen.queryByAltText('原图片.jpg 替换预览')).not.toBeInTheDocument());
  });

  it('keeps the announcement editor and action bar above the app navigation', () => {
    render(<NoticeEditor
      busy={false}
      draft={createEmptyNoticeDraft(['store-1'])}
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onPublish={vi.fn()}
      onSave={vi.fn()}
      onUpload={vi.fn().mockResolvedValue(undefined)}
      recipients={[]}
      stores={[{ id: 'store-1', name: '测试门店' }]}
    />);

    expect(screen.getByRole('dialog', { name: '新建公告' })).toHaveClass('h-[100dvh]', 'z-50');
    expect(screen.getByRole('button', { name: '发布公告' }).closest('.safe-bottom')).toHaveClass('fixed', 'z-[60]');
  });

  it('renames an in-use SOP category after a second confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRename = vi.fn().mockResolvedValue(true);
    render(<SopCategoryManager
      busy={false}
      categories={[{ id: 'category-1', name: '旧分类' }] as never}
      errorMessage={null}
      newCategoryName=""
      onChangeName={vi.fn()}
      onClose={vi.fn()}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onRename={onRename}
      sops={[{ category: '旧分类' }, { category: '旧分类' }] as never}
    />);

    fireEvent.click(screen.getByRole('button', { name: '修改分类 旧分类' }));
    fireEvent.change(screen.getByRole('textbox', { name: '修改分类 旧分类' }), { target: { value: '新分类' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'category-1', name: '旧分类' }), '新分类'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('同步修改该分类下 2 个 SOP'));
    confirm.mockRestore();
  });

  it('distinguishes a publish failure from a draft save failure', () => {
    expect(formatSopActionError('publishing', new Error('database rejected publish')))
      .toBe('SOP 草稿已保存，但发布失败：database rejected publish');
    expect(formatSopActionError('saving', new Error('network unavailable')))
      .toBe('SOP 保存失败：network unavailable');
  });
});

describe('SOP batch operations', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('places import, publish, retract and archive in the batch operations menu', () => {
    render(<SopBatchOperationsMenu onAction={vi.fn()} onClose={vi.fn()} onImport={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: '选择批量操作' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /批量导入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /批量发布/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /批量撤回/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /批量归档/ })).toBeInTheDocument();
  });

  it('selects an image folder and displays live import progress', async () => {
    const onImport = vi.fn(async (_workbook: File, _images: File[], onProgress: (progress: SopBatchImportProgress) => void) => {
      onProgress({ completed: 2, detail: '正在上传 3/5：step-03.jpg', percent: 62, phase: 'uploading', total: 5 });
      return null;
    });
    const { container } = render(<SopBatchImporter busy={false} errorMessage={null} onCancel={vi.fn()} onImport={onImport} />);
    const workbook = sopWorkbookFile([{ '产品名称': '测试 SOP', '分类': '测试', '步骤序号': 1, '步骤图片文件名': 'step-01.jpg' }]);
    const images = [new File(['1'], 'step-01.jpg', { type: 'image/jpeg' }), new File(['2'], 'step-02.png', { type: 'image/png' })];

    fireEvent.change(container.querySelector<HTMLInputElement>('input[accept=".xlsx,.xls"]')!, { target: { files: [workbook] } });
    const folderInput = container.querySelector<HTMLInputElement>('input[webkitdirectory]');
    expect(folderInput).not.toBeNull();
    fireEvent.change(folderInput!, { target: { files: images } });
    expect(screen.getByText('当前浏览器使用兼容模式，已建立 2 张候选图片的本地索引', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('系统仍只会在开始导入后上传 Excel 实际引用的图片', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '开始导入草稿' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(workbook, [images[0]], expect.any(Function)));
    expect(screen.getByText('Excel 引用').parentElement).toHaveTextContent('1Excel 引用');
    expect(screen.getByText('文件夹匹配').parentElement).toHaveTextContent('1文件夹匹配');
    expect(screen.getByText('不会上传').parentElement).toHaveTextContent('1不会上传');
    expect(screen.getByRole('progressbar', { name: 'SOP 批量导入进度' })).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByText('正在上传 3/5：step-03.jpg')).toBeInTheDocument();
  });

  it('uses a directory handle and reads only the image referenced by Excel', async () => {
    const referencedFile = new File(['used'], 'used.jpg', { type: 'image/jpeg' });
    const referencedGetFile = vi.fn().mockResolvedValue(referencedFile);
    const unusedGetFile = vi.fn().mockResolvedValue(new File(['unused'], 'unused.jpg', { type: 'image/jpeg' }));
    const directoryHandle = {
      kind: 'directory' as const,
      name: 'SOP图片',
      values: async function* () {
        yield { getFile: referencedGetFile, kind: 'file' as const, name: 'used.jpg' };
        yield { getFile: unusedGetFile, kind: 'file' as const, name: 'unused.jpg' };
      },
    };
    const picker = vi.fn().mockResolvedValue(directoryHandle);
    vi.stubGlobal('showDirectoryPicker', picker);
    const onImport = vi.fn().mockResolvedValue(null);
    const { container } = render(<SopBatchImporter busy={false} errorMessage={null} onCancel={vi.fn()} onImport={onImport} />);
    const workbook = sopWorkbookFile([{ '产品名称': '测试 SOP', '分类': '测试', '步骤序号': 1, '步骤图片文件名': 'used.jpg' }]);

    fireEvent.change(container.querySelector<HTMLInputElement>('input[accept=".xlsx,.xls"]')!, { target: { files: [workbook] } });
    fireEvent.click(screen.getByRole('button', { name: '选择图片文件夹' }));

    await waitFor(() => expect(picker).toHaveBeenCalledWith({ mode: 'read' }));
    expect(await screen.findByText('已选择文件夹“SOP图片”', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('没有读取或上传其中的图片', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '开始导入草稿' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(workbook, [referencedFile], expect.any(Function)));
    expect(referencedGetFile).toHaveBeenCalledTimes(1);
    expect(unusedGetFile).not.toHaveBeenCalled();
  });

  it('allows a pure-text workbook to continue without selecting an image folder', async () => {
    const onImport = vi.fn().mockResolvedValue(null);
    const { container } = render(<SopBatchImporter busy={false} errorMessage={null} onCancel={vi.fn()} onImport={onImport} />);
    const workbook = sopWorkbookFile([{ '产品名称': '纯文字 SOP', '分类': '测试', '步骤序号': 1, '步骤说明': '纯文字步骤' }], 'text-only-sops.xlsx');

    fireEvent.change(container.querySelector<HTMLInputElement>('input[accept=".xlsx,.xls"]')!, { target: { files: [workbook] } });
    fireEvent.click(screen.getByRole('button', { name: '开始导入草稿' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(workbook, [], expect.any(Function)));
  });

  it('shows success and failure counts with detailed reasons after a mixed SOP import', async () => {
    const onImport = vi.fn().mockResolvedValue({
      failed: 1,
      failures: [{ item: 'SOP“重复名称”', reason: '系统中已存在同名 SOP。' }],
      imported: 2,
      steps: 5,
      total: 3,
    });
    const { container } = render(<SopBatchImporter busy={false} errorMessage={null} onCancel={vi.fn()} onImport={onImport} />);
    const workbook = sopWorkbookFile([{ '产品名称': '混合 SOP', '分类': '测试', '步骤序号': 1, '步骤说明': '步骤' }], 'mixed-sops.xlsx');

    fireEvent.change(container.querySelector<HTMLInputElement>('input[accept=".xlsx,.xls"]')!, { target: { files: [workbook] } });
    fireEvent.click(screen.getByRole('button', { name: '开始导入草稿' }));

    expect(await screen.findByRole('dialog', { name: 'SOP 批量上传完成' })).toHaveTextContent('上传成功2上传失败1');
    expect(screen.getByRole('dialog', { name: 'SOP 批量上传完成' })).toHaveTextContent('SOP“重复名称”');
    expect(screen.getByRole('dialog', { name: 'SOP 批量上传完成' })).toHaveTextContent('系统中已存在同名 SOP');
  });
});

describe('SOP archive management', () => {
  it('offers cancel archive and permanent delete as separate actions', () => {
    const archived = { assetUrls: [], category: '奶茶', id: 'sop-1', status: 'archived', title: '珍珠奶茶' } as never;
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<SopArchiveManager busy={false} onClose={vi.fn()} onDelete={onDelete} onRestore={onRestore} sops={[archived]} />);

    fireEvent.click(screen.getByRole('button', { name: '取消归档 珍珠奶茶' }));
    expect(onRestore).toHaveBeenCalledWith(archived);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('恢复为待发布草稿', { exact: false })).toBeInTheDocument();
  });
});
