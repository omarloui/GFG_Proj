# Project Specification



## 1. Overview
## main concept: 
-- This app will target teachers who handle children with behavioral issues like ADHD, ODD, and Autism. The journey starts by prompting the user with clinical and diagnostic screening questions (sourced from our supporting medical documents). We then use this information to generate a primary set of student files: 1) a compiled behavioral history of the child, 2) core student info (age, grade, special needs), and 3) agent-generated research. Specifically, multiple search agents will be triggered with predefined search parameters to gather context from highly reliable, peer-reviewed medical and health authority sources (prioritizing trusted academic/government domains like `.gov` or `.edu` and avoiding commercial blogs). Finally, the app will generate an interactive visualization (such as progression/regression tracking graphs) to map and showcase the student's development.
## 2. Target Audience & Research method
The app is for sepecial eduacatin teachers and maybe parents too. Its main perpose it to put the data collected throughtout a long peroid in the form of graphs and charts so it can be easily understood,  which will help them make informed decisions about the students' educational and behavioral support plans. In addition to that the page should contain agents that could research the internet **ONLY FROM CREDIBLE SOURCES** and present the findings in a way that it could be easily understood, specifically avoiding domains like: .com, .ai, blogs etc.; and take from doamins like: .gov, .edu, .org, .nih, .cdc, .mayoclinic.org, medscape.com, nature.com, sciencedirect.com, nlm.nih.gov, ncbi.nlm.nih.gov, cdc.gov, nih.gov, nlm.nih.gov, mayoclinic.org, and also from **google scholar**.

## 3. Core Features & Requirements
*List the must-have features for the first version (MVP).*
# there are three sections in this page:
1) file manager that can handle crud file operations. the file manager should also be ready to allow gemini to create, and delete, and modify files. the file manager should be based on OPFS (Origin Private File System) so that the files stay in the tabs reach for the longest time possible. It should also allow users to export their data in the form of files, so they can store it in their local drives, google drive, etc. It should also have a search function that can search through the files. we will immbed the three files in the supproting documents.
2) there should be a chat section, it should allow the user to chat with gemini about anything, and gemini should be able to respond to the user's queries in a way that it could be easily understood. keeping in mind the context of the documents the user imported.
3) there should be a pdf viewer section where the user can view the pdf files imported/created. In addition to that it should be able to allow gemini to select and point to the specific data in the pdf files that the user wants it to focus on, and gemini should be able to understand the context of the data and respond accordingly. 

links suggested for gemini to access: 
## BUT keep these restrictions in mind: 1- Paywall Restraints, 2- No Boolean Building
### Medical Journals & Databases
* **ScienceDirect**: [sciencedirect.com](https://sciencedirect.com)
* **Nature Portfolio Journals**: [nature.com](https://nature.com)
* **Medscape**: [medscape.com](https://medscape.com)
* **NCBI**: [ncbi.nlm.nih.gov](https://nih.gov)

### Official Health Authorities
* **CDC**: [cdc.gov](https://www.cdc.gov/act-early/media/pdfs/2025/10/cdc-milestone-checklists-ltsae-english-508.pdf)
* **NIH**: [nih.gov](https://nih.gov)

### Research & Patient Resources
* **NLM**: [nlm.nih.gov](https://nih.gov)
* **Mayo Clinic**: [mayoclinic.org](https://mayoclinic.org)

- We are going to target mainly these disorders:
  1. Attention-Deficit/Hyperactivity Disorder (ADHD)
  2. Oppositional Defiant Disorder (ODD)
  3. Autism Spectrum Disorder (ASD) Behavioral Manifestations


## 4. User Interface & Experience (UI/UX)
The layout should look like arxive chat interms of sections and should have the same color sheme as gemini but with a purpule tint. Button should be big and clear, i want it to look minimalist and clean. The layout should be able to handle phone screen also, make sure to hide what is nessary when in phone view. we are not going to have a server, everything is going to run in the browser. make sure to use mui ui elements for a standarized look. 
avoid AI looking gradients and use solid-ish colors to give some identity to the app. 
## 5. Technical Requirements & Behavior
so our app is going to gemini centric. the user would have to past his own api url of gemini to use the app, make sure to have indicators of connectivity, and errors, and api issues etc. the ai key, file paths, and other data should be stored in the browser's localStorage and IndexedDB to ensure privacy and security. we are going to make use of worker threads to process pdfs and other tasks so that the ui stays responsive. there are three files in the supproting docs folder imbed them in the page so that it should be the main source for gemini, remember that we do have a server and eveything will loaded on the users device locally no cloud stuff. make sure to use lit-html for frontend rendering for speed. 

# the page structure, sections
* **header**: should display the name of the app, and a button to toggle theme. should have a clean and minimalist design, no clutter, just the essensials
* **sidebar**: will have three main tabs, file manager, chat, and pdf viewer
* **file manager**: will have a search bar, and a list of files. 
* **chat**: will have a chat interface, with a input field, and a chat history
* **pdf viewer**: will have a pdf viewer, with a scroll bar
* **footer**: will display the name of the app, and a button to toggle theme, should have a clean and minimalist design


