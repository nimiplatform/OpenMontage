export type StoryScene = {
  readonly title: string;
  readonly narration: string;
  readonly imagePrompt: string;
};

export type Storyboard = {
  readonly title: string;
  readonly scenes: readonly StoryScene[];
};

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(label + '缺失或超出长度限制。');
  return value.trim();
}

export function parseStoryboard(source: string): Storyboard {
  const cleaned = source.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(cleaned); } catch { throw new Error('文字服务没有返回完整的制作方案，请重新准备方案。'); }
  if (!value || typeof value !== 'object' || !('scenes' in value) || !('title' in value)) throw new Error('制作方案格式不完整。');
  if (!Array.isArray(value.scenes) || value.scenes.length !== 3) throw new Error('当前解说管线需要三个场景。');
  return {
    title: text(value.title, '标题', 120),
    scenes: value.scenes.map((scene: unknown) => {
      if (!scene || typeof scene !== 'object' || !('title' in scene) || !('narration' in scene) || !('imagePrompt' in scene)) throw new Error('场景内容不完整。');
      return { title: text(scene.title, '场景标题', 100), narration: text(scene.narration, '旁白', 1200), imagePrompt: text(scene.imagePrompt, '画面描述', 3000) };
    }),
  };
}

export function storyboardMessages(material: string, durationSeconds: number) {
  if (!material.trim() || material.length > 12000) throw new Error('请提供 1–12000 字符的事实材料。');
  if (![30, 45, 60].includes(durationSeconds)) throw new Error('请选择支持的目标时长。');
  return [
    { role: 'system' as const, text: '你是 OpenMontage 的解说视频编导。只依据用户提供的事实材料制作三个场景，不假称做过网络研究，不补造事实、来源或报价。保持材料的语言。只返回 JSON：{"title":"片名","scenes":[{"title":"场景标题","narration":"可直接朗读的旁白","imagePrompt":"具体的横向配图描述"}]}。scenes 必须恰好三项。旁白不要包含舞台指令或配音标记，配图描述不要要求在图片中生成文字，三个画面保持一致的视觉风格。' },
    { role: 'user' as const, text: '目标时长约 ' + durationSeconds + ' 秒。中文旁白总量参考 ' + Math.round(durationSeconds * 4) + '–' + Math.round(durationSeconds * 5) + ' 个汉字；英文参考每秒 2–3 个单词。用分步解释充分展开已有事实，不为凑时长补造事实。实际时长会在语音生成后核对。\n\n事实材料：\n' + material.trim() },
  ];
}
