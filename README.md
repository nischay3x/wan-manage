# About flexiWAN

flexiWAN is the world's first open source [SD-WAN](https://flexiwan.com/). flexiWAN offers a complete SD-WAN solution comprising of flexiEdge (the edge router) and flexiManage (the central management system) with core SD-WAN functionality. Our mission is to democratize the SD-WAN Market through an open source & modular  SD-WAN solution lowering barriers to entry for companies to adopt it or offer services based on the flexiWAN SD-WAN solution. To learn more about the flexiWAN's unique approach to networking, visit the [flexiWAN](https://flexiwan.com/) website, and follow the company on [Twitter](https://twitter.com/FlexiWan) and [LinkedIn](https://www.linkedin.com/company/flexiwan).

To contact us please drop us an email at yourfriends@flexiwan.com, or for any general issue please use our [Google User Group](https://groups.google.com/a/flexiwan.com/forum/#!forum/flexiwan-users)

# flexiManage

This repository contains the flexiManage backend component from flexiWAN. flexiManage service is used for managing [flexiEdge devices](https://docs.flexiwan.com/overview/arch.html#flexiedge). It allows users to create users and accounts and manage the entire network inventory of the organizations in the account.

Our hosted service https://manage.flexiwan.com provides a free UI access to the flexiManage service where users can create an account and use up to 3 flexiEdge devices for free.

## Install and use flexiManage locally

### Prerequisites
FlexiManagre requires the following to run:
* Node.js v10+
* npm v6+
* MongoDB 4.0.9, running as a replica-set with 3 nodes on ports 27017, 27018, 27019
* Redis 5.0.5, running on port 6379
* A mailer application or trapper of your choice, running on port 1025 (Such as [python mailtrap](https://pypi.org/project/mailtrap/))

### Installing
##### Getting the source code:
```
mkdir flexiManage
cd flexiManage
git clone https://gitlab.com/flexiwangroup/fleximanage.git .
```

##### Installing dependencies:
```
cd backend
npm install
```

### Running
```
npm start
```

### Documentation
For full documentation of flexiManage, please refer to [flexiManage documentation](https://docs.flexiwan.com/management/management-login.html).

## Versioning

FlexiManage uses [SemVer](https://semver.org/) scheme for versioning.

## License

This project is licensed under the GNU AGPLv3 License - see the [LICENSE.md](https://gitlab.com/flexiwangroup/fleximanage/blob/master/LICENSE) file for details

## Other Open Source Used

This project uses other Open Source components listed [here](https://gitlab.com/flexiwangroup/fleximanage/blob/master/OPENSOURCE.md).
