# 02 跃下入局

第二轮分镜 · 待联合分镜确认

## 意图与关联
跃下入局；场景 sc1，人物 keeper/challenger，场地 courtyard。

## 空间
坐标沿用 bible/design.md：+X 东、+Y 北，石台直径8m、高0.15m；北阶8级、每级0.15m，顶端(0,8.4,1.2)；西断廊X=-9，钟楼(8,7)，大树(9,-6)。两人身高1.78/1.80m，剑刃0.78m。所有镜头共用庭院和人物轨迹，禁止逐镜挪动地标。

## 时间与构图
源片6秒，24fps，共144帧；854×480。跃距5.4m/1.25s=4.32m/s，为武侠起跳而非步行；1.25秒接地后才起尘。落点(0,3,0.15)，不把北阶挪到石台旁。

| 本地成片时钟/秒 | 节拍 | 归属 | detail / 画面设计 |
|---|---|---|---|
| 0–1.25 | 蹬阶跃下 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Explosively, the challenger releases his loaded knees and leaps south from the landing, eyes fixed ahead, ponytail and sash streaming behind. |
| 1.25–1.5 | 鞋底触石 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | At normal speed his soles hit the northern dais at 1.25 seconds; knees compress, a tight dust puff follows contact, jaw clenched. |
| 1.5–2.5 | 卸力站稳 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | He rises deliberately from the landing crouch, lowers the blade and plants both feet; coat overshoots then settles, gaze unwavering. |
| 2.5–5.5 | 透视压近 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Hold his upright torso and intent expression still while the background compresses behind him; dust subsides, the red sash loses momentum. |
| 5.5–6 | 三米对峙 | blocked：位移／朝向／事件；acted：肢体／剑法／表情／衣料 | Hold the settled stance three metres from the keeper, sword down and breathing controlled; no extra step or attack. |
| 0–6 | 单一机位 | blocked：机位 | One dolly zoom after landing holds torso scale and ends still, background compressed; one continuous shot, no cut. |

## 相机
单一 dolly zoom：35mm、相机(-1,-3,2.0)瞄准落点上身(0,3,1.1)；0–2.5秒固定开场机位；2.5–5.5秒沿视线退至(-1.65,-6.9,2.59)，焦距35→57.75mm，人物上身尺度近似不变；最后0.5秒停稳。不叠加推近、摇镜或切镜。

分镜图选本地2.5秒。图像参考只提供外观；准确尺度与相机在白模复核。每镜一段连续镜头，不允许模型自行切镜，no music。

## 入点
Challenger screen left on the north landing (0,8.4,1.2), facing south, knees compressed, right-hand sword behind his hip; keeper screen right at (0,0,0.15), facing north, right-hand sword lowered; no contact.

## 剪辑出点
Challenger at (0,3,0.15), facing south toward the offscreen keeper, upright after landing, right-hand sword lowered, feet planted; keeper at (0,0,0.15), facing north, sword lowered; three metres apart, dust settled, no contact.

## 切点决策
continuous action；同一动作持续发生，只换机位，无时间省略。entry逐字取自上一镜使用区间的exit，声明continuity并按顺序生成、选择take。

## 因果与验收
脚触地先于尘；剑接触先于拨偏／剑光；停锋先于垂剑；见垂剑后才收锋。每把剑只一柄，剑鞘不可变第二武器。切点复核脚位、重心、朝向、剑位、衣摆惯性及尘的位置；过轴只允许03连续环绕，04–06全在X<0。

## 时钟与白模实施约定
所有上表秒数为shot clock。白模以动作时钟建轨，slowmo后用shot_time/action_time对照这些既定拍点；源片终点不得吞掉垂剑或停驻。04–06调用同一杀招主轨，用显式offset 0/1/2秒转换本地时钟；不是各写一套动作。慢放和impact也在主时钟定义再转换，禁止分别压缩三个角度的动作。白模是无四肢的有朝向棋子；手腕、劈刺、脸部仅acted，白模负责位移、触点和安全停锋标记。

## 假设
沿用原剧本36秒源片／30秒成片、24fps、480p、服装与场景；第二轮新预算$20覆盖本轮增量，不重算已发生设定费。机位坐标和微观拍点是本轮待批准设计，白模验证前不宣称空间或动画验收通过。


### 用户批准的新机位实施

按用户本次批准换为(-5,0,2.1)、目标(0,3.9,1.6)、35mm起始；2.5–5.5秒1.65倍dolly zoom保持。最终rev3已消除守剑人擦边。
