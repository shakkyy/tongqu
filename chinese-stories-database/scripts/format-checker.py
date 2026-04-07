#!/usr/bin/env python3
"""
故事文件格式检查工具
检查所有故事文件是否符合标准格式
"""

import os
import re
import json
from pathlib import Path

def check_markdown_file(filepath):
    """检查单个故事文件的格式"""
    errors = []
    warnings = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 检查是否有YAML元数据
    if not content.startswith('---'):
        errors.append("缺少YAML元数据")
    
    # 检查必要字段
    required_fields = ['id:', 'title:', 'source:', 'category:', 'difficulty:']
    for field in required_fields:
        if field not in content[:500]:  # 只检查前500字符
            errors.append(f"缺少字段: {field}")
    
    # 检查是否有插图提示
    if 'illustration_prompts' not in content:
        warnings.append("建议添加插图提示")
    
    # 检查是否有互动思考
    if '互动思考' not in content:
        warnings.append("建议添加互动思考部分")
    
    return errors, warnings

def main():
    stories_dir = Path(__file__).parent.parent / 'stories'
    
    total_errors = 0
    total_warnings = 0
    
    for md_file in stories_dir.rglob('*.md'):
        if md_file.name == 'index.md':
            continue
            
        print(f"\n检查: {md_file}")
        errors, warnings = check_markdown_file(md_file)
        
        for err in errors:
            print(f"  ❌ 错误: {err}")
            total_errors += 1
        
        for warn in warnings:
            print(f"  ⚠️  警告: {warn}")
            total_warnings += 1
        
        if not errors and not warnings:
            print(f"  ✅ 格式正确")
    
    print(f"\n总计: {total_errors} 错误, {total_warnings} 警告")

if __name__ == '__main__':
    main()