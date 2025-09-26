# analogarchivejs
Analogarchivejs displays a directory of mp3 files using their meta-data (artist, album, song) in a standalone webserver app, with the ability to play them in a streaming audio player.      
Just put a "music" sub-directory in the working directory of analogarchivejs (where index.js is located), and put all of your mp3s in that directory.  
When you start the app and call it from a requesting browser, it reads all of the mp3 files in the music directory and displays them in a list of audio playable links... just click a link to play and/or download
the mp3 file.  

SETUP (mac/linux. pc will differ in creating the self signed certificate):
1. install node.js: `https://nodejs.org/en/download`. 
2. clone this repository: `git clone https://github.com/jimarasim/analogarchivejs.git`. 
3. install the node modules in the working directory (same directory as index.js): `npm install`. 
4. Create an `ssl` directory in the working directory (same directory as index.js): `mkdir ssl`. 
5. Create a self-signed certificate: `openssl req -nodes -new -x509 -keyout server.key -out server.cert`. 
6. Put `server.key` and `server.cert` in the `ssl` directory. 
7. Create a `music` directory in the working directory (same directory as index.js): `mkdir music`  
8. Put all of your mp3 files in the `music` directory.
9. Run the app from the working directory (same directory as index.js): `node .`. 
10. Load the webpage on your local host: open a browser and navigate to `https://localhost:50001`. 
