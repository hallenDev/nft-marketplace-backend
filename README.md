# voxelx_backend

# Installation
 - npm install
 - npm start

# Server configuraton
mv ormconfig.prod.json ormconfig.json 

pm2 start npm --name "voxelx_api" -- start
pm2 delete "voxelx_api"

sudo ufw status