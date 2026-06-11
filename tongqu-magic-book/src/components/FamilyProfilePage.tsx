import { Save, Trash2, Upload, UserPlus, UsersRound, X } from "lucide-react";
import type { FamilyMemberProfile } from "../types";
import { createFamilyMemberProfile } from "../lib/familyProfileStorage";
import { makeImageThumbnailDataUrl, readFileAsDataUrl } from "../lib/imageUtils";

interface FamilyProfilePageProps {
  profiles: FamilyMemberProfile[];
  onProfilesChange: (profiles: FamilyMemberProfile[]) => void;
  onSave: () => void;
  onBackToCreate: () => void;
  notice?: string | null;
  disabled?: boolean;
}

const MAX_MEMBER_PHOTO_BYTES = 5 * 1024 * 1024;

export function FamilyProfilePage({
  profiles,
  onProfilesChange,
  onSave,
  onBackToCreate,
  notice,
  disabled,
}: FamilyProfilePageProps) {
  const updateMember = (id: string, patch: Partial<FamilyMemberProfile>) => {
    onProfilesChange(
      profiles.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
  };

  const addMember = () => {
    onProfilesChange(
      [
        ...profiles,
        createFamilyMemberProfile({
          displayName: `家人${profiles.length + 1}`,
          relation: "家人",
        }),
      ].slice(0, 8),
    );
  };

  const removeMember = (id: string) => {
    if (profiles.length <= 1) return;
    onProfilesChange(profiles.filter((item) => item.id !== id));
  };

  const uploadPhoto = async (id: string, file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("请上传 JPG / PNG / WebP 等图片文件。");
      return;
    }
    if (file.size > MAX_MEMBER_PHOTO_BYTES) {
      window.alert("成员照片太大，请压缩到 5MB 以内再上传。");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const thumb = await makeImageThumbnailDataUrl(dataUrl, 420);
    updateMember(id, { photoThumb: thumb });
  };

  const photoCount = profiles.filter((item) => item.photoThumb).length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden font-classical">
      <div className="flex flex-shrink-0 flex-col gap-3 border-b-2 border-cn-ink/15 bg-white/85 px-4 py-4 lg:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-cn-ink bg-cn-red text-white shadow-[2px_2px_0px_#1A2B3C]">
              <UsersRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-black leading-tight text-cn-ink">家庭角色库</h2>
              <p className="text-[11px] font-bold text-cn-ink/50">
                {profiles.length} 位成员 · {photoCount} 张本地照片 · 当前浏览器保存
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onBackToCreate}
              className="rounded-full border-2 border-cn-ink bg-white px-4 py-2 text-xs font-black text-cn-ink hover:bg-cn-yellow"
            >
              返回创作台
            </button>
            <button
              type="button"
              onClick={addMember}
              disabled={disabled || profiles.length >= 8}
              className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-white px-3 py-2 text-xs font-black text-cn-ink hover:bg-cn-paper disabled:opacity-45"
            >
              <UserPlus className="h-4 w-4" />
              添加成员
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={disabled}
              className="flex items-center gap-1.5 rounded-full border-2 border-cn-ink bg-cn-red px-4 py-2 text-xs font-black text-white shadow-[1px_2px_0px_#1A2B3C] hover:translate-y-[-1px] disabled:opacity-45"
            >
              <Save className="h-4 w-4" />
              保存角色库
            </button>
          </div>
        </div>
        <div className="rounded-xl border-2 border-dashed border-cn-red/45 bg-cn-red/10 px-3 py-2 text-[11px] font-bold leading-relaxed text-cn-ink/70">
          成员照片和角色描述保存在当前浏览器。生成时本次合照优先；如果没有合照，会把已启用成员照片合成为一张角色参考图，仅用于本次 Agent 生成。
          {notice ? <span className="ml-2 text-cn-red">{notice}</span> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 hide-scrollbar">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((member) => (
            <div key={member.id} className="rounded-2xl border-2 border-cn-ink bg-white p-3 shadow-[3px_3px_0px_rgba(26,43,60,0.12)]">
              <div className="flex gap-3">
                <div className="w-24 flex-shrink-0">
                  <div className="relative aspect-square overflow-hidden rounded-xl border-2 border-cn-ink/35 bg-cn-paper">
                    {member.photoThumb ? (
                      <>
                        <img src={member.photoThumb} alt={member.displayName} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => updateMember(member.id, { photoThumb: undefined })}
                          disabled={disabled}
                          className="absolute right-1 top-1 rounded-full border border-cn-ink bg-white p-0.5 hover:bg-cn-yellow disabled:opacity-45"
                          title="移除照片"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-1 text-center hover:bg-white/75">
                        <Upload className="h-5 w-5 text-cn-red" />
                        <span className="px-1 text-[9px] font-black leading-tight text-cn-ink/60">上传成员照片</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          disabled={disabled}
                          onChange={(e) => {
                            void uploadPhoto(member.id, e.target.files?.[0] ?? null);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <label className="mt-2 flex items-center justify-center gap-1 text-[10px] font-black text-cn-ink/65">
                    <input
                      type="checkbox"
                      checked={member.enabled}
                      onChange={(e) => updateMember(member.id, { enabled: e.target.checked })}
                      disabled={disabled}
                      className="h-3.5 w-3.5 accent-cn-red"
                    />
                    本次可用
                  </label>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex gap-2">
                    <input
                      value={member.displayName}
                      onChange={(e) => updateMember(member.id, { displayName: e.target.value.slice(0, 24) })}
                      disabled={disabled}
                      className="min-w-0 flex-1 rounded-lg border-2 border-cn-ink/20 px-2 py-1 text-xs font-black text-cn-ink"
                      placeholder="昵称"
                    />
                    <input
                      value={member.relation}
                      onChange={(e) => updateMember(member.id, { relation: e.target.value.slice(0, 16) })}
                      disabled={disabled}
                      className="w-20 rounded-lg border-2 border-cn-ink/20 px-2 py-1 text-xs font-black text-cn-ink"
                      placeholder="关系"
                    />
                  </div>
                  <input
                    value={member.storyRole}
                    onChange={(e) => updateMember(member.id, { storyRole: e.target.value.slice(0, 32) })}
                    disabled={disabled}
                    className="mb-2 w-full rounded-lg border-2 border-cn-red/25 px-2 py-1 text-xs font-bold text-cn-ink"
                    placeholder="故事身份，例如：小小机关师"
                  />
                  <textarea
                    value={member.characterDescription}
                    onChange={(e) => updateMember(member.id, { characterDescription: e.target.value.slice(0, 180) })}
                    disabled={disabled}
                    rows={3}
                    maxLength={180}
                    className="mb-2 w-full resize-none rounded-lg border-2 border-cn-ink/15 px-2 py-1.5 text-[11px] leading-snug text-cn-ink"
                    placeholder="性格/行动方式"
                  />
                  <textarea
                    value={member.visualNotes}
                    onChange={(e) => updateMember(member.id, { visualNotes: e.target.value.slice(0, 180) })}
                    disabled={disabled}
                    rows={3}
                    maxLength={180}
                    className="w-full resize-none rounded-lg border-2 border-cn-ink/15 px-2 py-1.5 text-[11px] leading-snug text-cn-ink"
                    placeholder="外观锚点，例如衣服颜色、常带道具，避免真实人脸复刻"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeMember(member.id)}
                  disabled={disabled || profiles.length <= 1}
                  className="flex items-center gap-1 rounded-full border border-cn-ink/30 bg-white px-2 py-1 text-[10px] font-black text-cn-ink/55 hover:bg-cn-red hover:text-white disabled:opacity-35"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
