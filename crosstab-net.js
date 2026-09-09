(function(root){
  'use strict';
  const text=v=>String(v??'').trim();
  function parse(sheets){
    const questions={}, warnings=[];
    for(const sheet of sheets){
      let pending=[], groups=[], active=null, optionColumn=-1, blocked=false;
      const finish=()=>{
        if(pending.length&&groups.some(g=>g.codes.length)){
          for(const q of pending){
            const good=groups.filter(g=>g.codes.length);
            const codes=good.flatMap(g=>g.codes);
            if(blocked||new Set(codes).size!==codes.length||questions[q.id]){warnings.push(`${q.id}：分组或编码存在冲突，请手动核对。`);delete questions[q.id];continue;}
            questions[q.id]={...q,sheet:sheet.name,groups:good};
          }
        }
        pending=[];groups=[];active=null;optionColumn=-1;blocked=false;
      };
      (sheet.rows||[]).forEach((row,index)=>{
        const cells=row.map(text);
        const qi=cells.findIndex(v=>/^[A-Za-z]+\d+(?:_\d+[A-Za-z]*)?$/.test(v));
        if(qi>=0){
          const eligible=cells.some(v=>/NET\s*内随机/i.test(v))&&cells.some(v=>/单选|多选/.test(v));
          if(!eligible){finish();return;}
          if(groups.length)finish();
          pending.push({id:cells[qi].toUpperCase(),type:cells.some(v=>/多选/.test(v))?'multi':'single',row:index+1});
          optionColumn=qi+1;return;
        }
        if(!pending.length||optionColumn<0)return;
        const code=cells[optionColumn]||'',label=cells[optionColumn+1]||'';
        if(/^\d+$/.test(code)&&label){
          if(active)active.codes.push(String(Number(code)));
          else blocked=true;
        }else if(code&&!label&&!/^\d+$/.test(code)&&code.length<=30&&!/[【】？?]/.test(code)){
          active={name:code,codes:[]};groups.push(active);
        }
      });
      finish();
    }
    return {questions,warnings};
  }
  // 原始选项的提及率分母不包含汇总 NET。重叠组各自计算并仅展示一次原选项。
  function arrange(rows, groups, count, base){
    const result=[],shown=new Set();
    for(const group of groups){
      const keys=group.optionHeaders?.length?group.optionHeaders:(group.optionLabels||[]);
      const members=[...new Set(keys.map(key=>rows.find(r=>r.header===key||r.label===key)).filter(Boolean))];
      if(!members.length)continue;
      const n=count(members);
      result.push({label:/^NET\s*[-－—:：]/i.test(group.name)?group.name:`NET - ${group.name}`,header:null,count:n,percent:base?n/base:0,validPercent:base?n/base:0,countPercent:base?n/base:0,mentionPercent:0,isNetGroup:true});
      for(const member of members){if(!shown.has(member)){result.push(member);shown.add(member);}}
    }
    return result.concat(rows.filter(r=>!shown.has(r)));
  }
  root.CrosstabNet={parse,arrange};
})(globalThis);
