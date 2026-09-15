@echo off
cd /d "C:\Users\paula\OneDrive\Desktop\claude automacao\content-intelligence-platform\platform"
"C:\Program Files\nodejs\npx.cmd" tsx scripts\daily-content-pipeline.ts >> "C:\Users\paula\AppData\Local\Temp\claude\content-pipeline-daily.log" 2>&1
